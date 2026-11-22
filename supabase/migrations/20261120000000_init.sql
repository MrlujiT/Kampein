-- Kampein: initial schema
-- Multi-tenant campaign management. Every row belongs to one campaign and
-- row-level security (RLS) keeps each campaign's data isolated.
--
-- Hard rules baked into the schema:
--   * Money can only be paid to registered payees (staff, agents, vendors).
--     There is no concept of a voter anywhere in this database.
--   * The audit log is append-only.
--   * Election-day tallies need two independent entries per polling-station results form (35A–39A, by seat).


-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type seat_type as enum ('mca', 'mp', 'senator', 'woman_rep', 'governor');

create type member_role as enum (
  'owner',        -- the candidate
  'manager',      -- campaign manager
  'finance',      -- finance lead
  'coordinator',  -- ward coordinator
  'agent',        -- field / polling-station agent
  'clerk'         -- election-day data clerk
);

create type activity_kind as enum ('door_to_door', 'meeting', 'rally', 'recruitment', 'other');

create type payee_kind as enum ('member', 'vendor');

create type disbursement_status as enum ('requested', 'approved', 'rejected', 'paid');

create type tally_status as enum ('awaiting_entries', 'matched', 'disputed', 'confirmed');

-- ---------------------------------------------------------------------------
-- Campaigns and people
-- ---------------------------------------------------------------------------

create table campaigns (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  candidate_name text not null,
  seat           seat_type not null,
  county         text,
  constituency   text,
  ward           text,
  election_date  date default '2027-08-10',
  created_at     timestamptz not null default now()
);

create table wards (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references campaigns(id) on delete cascade,
  name              text not null,
  constituency      text,
  county            text,
  registered_voters integer not null default 0 check (registered_voters >= 0),
  -- share of registered voters the campaign aims to win, 0..1
  target_share      numeric(4,3) not null default 0.5 check (target_share between 0 and 1),
  created_at        timestamptz not null default now(),
  unique (campaign_id, name, constituency)
);

create table polling_stations (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references campaigns(id) on delete cascade,
  ward_id           uuid not null references wards(id) on delete cascade,
  code              text,          -- IEBC polling station code
  name              text not null,
  registered_voters integer not null default 0 check (registered_voters >= 0),
  created_at        timestamptz not null default now(),
  unique (campaign_id, code)
);

create table members (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references campaigns(id) on delete cascade,
  user_id            uuid references auth.users(id) on delete set null, -- null = no login (e.g. Telegram-only agent)
  full_name          text not null,
  phone              text,
  role               member_role not null,
  ward_id            uuid references wards(id) on delete set null,
  polling_station_id uuid references polling_stations(id) on delete set null,
  telegram_chat_id   bigint unique,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (campaign_id, user_id)
);

create index on members (campaign_id, role);
create index on members (user_id);

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so policies don't recurse into members RLS)
-- ---------------------------------------------------------------------------

create or replace function kp_my_role(p_campaign uuid)
returns member_role
language sql stable security definer set search_path = public as $$
  select role from members
  where campaign_id = p_campaign and user_id = auth.uid() and active
  limit 1;
$$;

create or replace function kp_is_member(p_campaign uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select kp_my_role(p_campaign) is not null;
$$;

create or replace function kp_has_role(p_campaign uuid, p_roles member_role[])
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(kp_my_role(p_campaign) = any(p_roles), false);
$$;

create or replace function kp_my_member_id(p_campaign uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select id from members
  where campaign_id = p_campaign and user_id = auth.uid() and active
  limit 1;
$$;

create or replace function kp_my_ward(p_campaign uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select ward_id from members
  where campaign_id = p_campaign and user_id = auth.uid() and active
  limit 1;
$$;

-- Creating a campaign also makes the caller its owner.
create or replace function create_campaign(
  p_name text, p_candidate text, p_seat seat_type, p_owner_name text,
  p_county text default null, p_constituency text default null, p_ward text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into campaigns (name, candidate_name, seat, county, constituency, ward)
  values (p_name, p_candidate, p_seat, p_county, p_constituency, p_ward)
  returning id into v_id;
  insert into members (campaign_id, user_id, full_name, role)
  values (v_id, auth.uid(), p_owner_name, 'owner');
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Field activity
-- ---------------------------------------------------------------------------

create table activities (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references campaigns(id) on delete cascade,
  member_id      uuid not null references members(id) on delete cascade,
  ward_id        uuid references wards(id) on delete set null,
  kind           activity_kind not null,
  people_reached integer not null default 0 check (people_reached >= 0),
  notes          text,
  lat            double precision,
  lng            double precision,
  photo_path     text,           -- storage path in the 'activity-photos' bucket
  source         text not null default 'web' check (source in ('web', 'telegram')),
  occurred_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index on activities (campaign_id, occurred_at desc);
create index on activities (campaign_id, ward_id);

-- ---------------------------------------------------------------------------
-- Money: budgets, payees, disbursements
-- ---------------------------------------------------------------------------

create table budgets (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  ward_id     uuid references wards(id) on delete set null, -- null = campaign-wide
  category    text not null check (category in ('transport', 'meals', 'materials', 'venues', 'agent_stipends', 'media', 'other')),
  amount_kes  numeric(14,2) not null check (amount_kes >= 0),
  period_start date,
  period_end   date,
  notes       text,
  created_at  timestamptz not null default now()
);

-- Only staff, agents and vendors can be paid. No voter payees, by design.
create table payees (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  kind        payee_kind not null,
  member_id   uuid references members(id) on delete restrict,
  name        text not null,
  phone       text,
  kra_pin     text,
  created_at  timestamptz not null default now(),
  check ((kind = 'member' and member_id is not null) or (kind = 'vendor' and member_id is null))
);

create table disbursements (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  budget_id    uuid not null references budgets(id) on delete restrict,
  payee_id     uuid not null references payees(id) on delete restrict,
  amount_kes   numeric(14,2) not null check (amount_kes > 0),
  purpose      text not null,
  status       disbursement_status not null default 'requested',
  requested_by uuid not null references members(id),
  decided_by   uuid references members(id),
  decided_at   timestamptz,
  paid_at      timestamptz,
  mpesa_ref    text,
  created_at   timestamptz not null default now()
);

create index on disbursements (campaign_id, status);

-- Once requested, a disbursement's amount, payee and purpose are frozen.
-- Only the status moves, along requested -> approved/rejected -> paid,
-- and nobody can approve their own request.
create or replace function kp_disbursement_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_me uuid := kp_my_member_id(new.campaign_id);
begin
  if new.amount_kes  is distinct from old.amount_kes
  or new.payee_id    is distinct from old.payee_id
  or new.budget_id   is distinct from old.budget_id
  or new.purpose     is distinct from old.purpose
  or new.requested_by is distinct from old.requested_by
  or new.campaign_id is distinct from old.campaign_id then
    raise exception 'Disbursement details cannot be changed after the request; reject it and raise a new one';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status = 'requested' and new.status in ('approved', 'rejected') then
    if v_me = old.requested_by then
      raise exception 'You cannot approve or reject your own request';
    end if;
    new.decided_by := v_me;
    new.decided_at := now();
  elsif old.status = 'approved' and new.status = 'paid' then
    if coalesce(trim(new.mpesa_ref), '') = '' then
      raise exception 'Record the M-Pesa (or bank) reference before marking as paid';
    end if;
    new.paid_at := now();
  else
    raise exception 'Cannot move a disbursement from % to %', old.status, new.status;
  end if;
  return new;
end $$;

create trigger disbursements_guard
  before update on disbursements
  for each row execute function kp_disbursement_guard();

-- ---------------------------------------------------------------------------
-- Election day: results-form (35A–39A) double-entry tallying (internal to the campaign)
-- ---------------------------------------------------------------------------

create table tally_candidates (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name        text not null,
  party       text,
  is_ours     boolean not null default false,
  sort_order  integer not null default 0
);

create table tally_forms (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references campaigns(id) on delete cascade,
  polling_station_id uuid not null references polling_stations(id) on delete restrict,
  photo_path         text not null,   -- storage path in the 'form34a' bucket
  uploaded_by        uuid not null references members(id),
  status             tally_status not null default 'awaiting_entries',
  final_votes        jsonb,           -- {candidate_id: votes}
  final_rejected     integer,
  resolved_by        uuid references members(id),
  uploaded_at        timestamptz not null default now(),
  unique (campaign_id, polling_station_id)
);

create table tally_entries (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  form_id     uuid not null references tally_forms(id) on delete cascade,
  entered_by  uuid not null references members(id),
  votes       jsonb not null,        -- {candidate_id: votes}
  rejected    integer not null default 0 check (rejected >= 0),
  created_at  timestamptz not null default now(),
  unique (form_id, entered_by)       -- the two entries must come from different clerks
);

-- When the second entry lands, compare it with the first.
create or replace function kp_compare_tally() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_first tally_entries%rowtype;
begin
  select count(*) into v_count from tally_entries where form_id = new.form_id;
  if v_count > 2 then
    raise exception 'This form already has two entries';
  end if;
  if v_count = 2 then
    select * into v_first from tally_entries
      where form_id = new.form_id and id <> new.id limit 1;
    if v_first.votes = new.votes and v_first.rejected = new.rejected then
      update tally_forms
        set status = 'confirmed', final_votes = new.votes, final_rejected = new.rejected
        where id = new.form_id;
    else
      update tally_forms set status = 'disputed' where id = new.form_id;
    end if;
  end if;
  return new;
end $$;

create trigger tally_entries_compare
  after insert on tally_entries
  for each row execute function kp_compare_tally();

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------

create table audit_log (
  id          bigserial primary key,
  campaign_id uuid not null,         -- no FK: the log must outlive what it describes
  actor       uuid,                  -- auth user id
  action      text not null,         -- INSERT / UPDATE / DELETE
  entity      text not null,         -- table name
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);

create index on audit_log (campaign_id, at desc);

create or replace function kp_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_log (campaign_id, actor, action, entity, entity_id, before, after)
  values (
    (v_row->>'campaign_id')::uuid,
    auth.uid(),
    tg_op,
    tg_table_name,
    (v_row->>'id')::uuid,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_members       after insert or update or delete on members       for each row execute function kp_audit();
create trigger audit_budgets       after insert or update or delete on budgets       for each row execute function kp_audit();
create trigger audit_payees        after insert or update or delete on payees        for each row execute function kp_audit();
create trigger audit_disbursements after insert or update or delete on disbursements for each row execute function kp_audit();
create trigger audit_tally_forms   after insert or update or delete on tally_forms   for each row execute function kp_audit();
create trigger audit_tally_entries after insert or update or delete on tally_entries for each row execute function kp_audit();

-- Money records are never deleted: corrections are new entries.
create or replace function kp_block_delete() returns trigger
language plpgsql as $$
begin
  raise exception '% records cannot be deleted; record a correction instead', tg_table_name;
end $$;

create trigger no_delete_disbursements before delete on disbursements for each row execute function kp_block_delete();
create trigger no_delete_audit         before delete or update on audit_log for each row execute function kp_block_delete();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table campaigns        enable row level security;
alter table wards            enable row level security;
alter table polling_stations enable row level security;
alter table members          enable row level security;
alter table activities       enable row level security;
alter table budgets          enable row level security;
alter table payees           enable row level security;
alter table disbursements    enable row level security;
alter table tally_candidates enable row level security;
alter table tally_forms      enable row level security;
alter table tally_entries    enable row level security;
alter table audit_log        enable row level security;

-- Campaigns: members read; owner/manager edit. Creation goes through create_campaign().
create policy campaigns_read   on campaigns for select using (kp_is_member(id));
create policy campaigns_update on campaigns for update using (kp_has_role(id, '{owner,manager}'));

-- Structure: every member reads; owner/manager maintain.
create policy wards_read  on wards for select using (kp_is_member(campaign_id));
create policy wards_write on wards for all
  using (kp_has_role(campaign_id, '{owner,manager}'))
  with check (kp_has_role(campaign_id, '{owner,manager}'));

create policy stations_read  on polling_stations for select using (kp_is_member(campaign_id));
create policy stations_write on polling_stations for all
  using (kp_has_role(campaign_id, '{owner,manager}'))
  with check (kp_has_role(campaign_id, '{owner,manager}'));

-- Members: everyone in the campaign sees the roster; owner/manager manage it,
-- coordinators can add agents in their own ward.
create policy members_read on members for select using (kp_is_member(campaign_id));
-- No delete policy: people are deactivated (active = false), never removed,
-- so the audit trail and payment history stay intact.
create policy members_admin_insert on members for insert
  with check (kp_has_role(campaign_id, '{owner,manager}') and role <> 'owner');
create policy members_admin_update on members for update
  using (kp_has_role(campaign_id, '{owner,manager}') and role <> 'owner')
  with check (kp_has_role(campaign_id, '{owner,manager}') and role <> 'owner');
create policy members_coordinator_add on members for insert
  with check (
    kp_has_role(campaign_id, '{coordinator}')
    and role = 'agent'
    and ward_id = kp_my_ward(campaign_id)
  );

-- Activities: leadership sees all; coordinators see their ward; agents see their own.
create policy activities_read on activities for select using (
  kp_has_role(campaign_id, '{owner,manager,finance}')
  or (kp_has_role(campaign_id, '{coordinator}') and ward_id = kp_my_ward(campaign_id))
  or member_id = kp_my_member_id(campaign_id)
);
create policy activities_insert on activities for insert with check (
  kp_is_member(campaign_id)
  and (
    member_id = kp_my_member_id(campaign_id)
    or kp_has_role(campaign_id, '{owner,manager}')
    or (kp_has_role(campaign_id, '{coordinator}') and ward_id = kp_my_ward(campaign_id))
  )
);

-- Money: owner, manager and finance see everything; coordinators see and
-- request against their own ward.
create policy budgets_read on budgets for select using (
  kp_has_role(campaign_id, '{owner,manager,finance}')
  or (kp_has_role(campaign_id, '{coordinator}') and ward_id = kp_my_ward(campaign_id))
);
create policy budgets_write on budgets for all
  using (kp_has_role(campaign_id, '{owner,finance}'))
  with check (kp_has_role(campaign_id, '{owner,finance}'));

create policy payees_read  on payees for select using (kp_has_role(campaign_id, '{owner,manager,finance,coordinator}'));
create policy payees_write on payees for insert with check (kp_has_role(campaign_id, '{owner,manager,finance}'));
create policy payees_update on payees for update using (kp_has_role(campaign_id, '{owner,finance}'));

create policy disb_read on disbursements for select using (
  kp_has_role(campaign_id, '{owner,manager,finance}')
  or requested_by = kp_my_member_id(campaign_id)
);
create policy disb_request on disbursements for insert with check (
  kp_has_role(campaign_id, '{owner,manager,finance,coordinator}')
  and requested_by = kp_my_member_id(campaign_id)
  and status = 'requested'
);
-- Decisions and payment marking: finance and owner only.
create policy disb_decide on disbursements for update using (kp_has_role(campaign_id, '{owner,finance}'));

-- Tallying
create policy tc_read  on tally_candidates for select using (kp_is_member(campaign_id));
create policy tc_write on tally_candidates for all
  using (kp_has_role(campaign_id, '{owner,manager}'))
  with check (kp_has_role(campaign_id, '{owner,manager}'));

create policy tf_read on tally_forms for select using (kp_has_role(campaign_id, '{owner,manager,clerk,coordinator}') or uploaded_by = kp_my_member_id(campaign_id));
create policy tf_upload on tally_forms for insert with check (
  kp_is_member(campaign_id) and uploaded_by = kp_my_member_id(campaign_id)
);
create policy tf_resolve on tally_forms for update using (kp_has_role(campaign_id, '{owner,manager}'));

create policy te_read on tally_entries for select using (kp_has_role(campaign_id, '{owner,manager}') or entered_by = kp_my_member_id(campaign_id));
create policy te_insert on tally_entries for insert with check (
  kp_has_role(campaign_id, '{clerk,manager,owner}') and entered_by = kp_my_member_id(campaign_id)
);

-- Audit log: leadership reads; nobody writes directly (triggers do).
create policy audit_read on audit_log for select using (kp_has_role(campaign_id, '{owner,manager,finance}'));

-- ---------------------------------------------------------------------------
-- Reporting views (respect RLS of the caller via security_invoker)
-- ---------------------------------------------------------------------------

create view ward_progress with (security_invoker = on) as
select
  w.id            as ward_id,
  w.campaign_id,
  w.name,
  w.constituency,
  w.registered_voters,
  round(w.registered_voters * w.target_share)::integer as target_votes,
  coalesce(sum(a.people_reached), 0)::integer         as people_reached,
  count(a.id)::integer                                 as activity_count,
  count(a.id) filter (where a.occurred_at > now() - interval '7 days')::integer as activities_7d
from wards w
left join activities a on a.ward_id = w.id
group by w.id;

create view member_leaderboard with (security_invoker = on) as
select
  m.id as member_id,
  m.campaign_id,
  m.full_name,
  m.role,
  m.ward_id,
  coalesce(sum(a.people_reached), 0)::integer as people_reached,
  count(a.id)::integer as activity_count,
  count(a.id) filter (where a.occurred_at > now() - interval '7 days')::integer as activities_7d
from members m
left join activities a on a.member_id = m.id
where m.active
group by m.id;

-- ---------------------------------------------------------------------------
-- Storage buckets (private)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values
  ('activity-photos', 'activity-photos', false),
  ('form34a', 'form34a', false)
on conflict (id) do nothing;

-- Files are stored under <campaign_id>/... so the first path segment decides access.
create policy "campaign members read files" on storage.objects for select using (
  bucket_id in ('activity-photos', 'form34a')
  and kp_is_member(((storage.foldername(name))[1])::uuid)
);
create policy "campaign members upload files" on storage.objects for insert with check (
  bucket_id in ('activity-photos', 'form34a')
  and kp_is_member(((storage.foldername(name))[1])::uuid)
);
