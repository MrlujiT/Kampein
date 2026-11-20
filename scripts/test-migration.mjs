// Runs the Supabase migration against an in-memory Postgres (PGlite) with
// stubbed auth/storage schemas, then checks the business rules and RLS.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const db = new PGlite();
const stub = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select string_to_array(name, '/') $$;
  create role authenticated;
  grant usage on schema public, auth, storage to authenticated;
`;
await db.exec(stub);
for (const f of readdirSync('supabase/migrations').sort()) {
  await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
}
await db.exec(`
  grant all on all tables in schema public to authenticated;
  grant all on all sequences in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
`);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };
const as = async (uid) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); ${uid ? 'set role authenticated;' : ''}`); };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const rejects = async (sql, p) => { try { await db.query(sql, p); return false; } catch { return true; } };

const U = { cand: '11111111-1111-1111-1111-111111111111', fin: '22222222-2222-2222-2222-222222222222',
            coord: '33333333-3333-3333-3333-333333333333', other: '44444444-4444-4444-4444-444444444444',
            clerk1: '55555555-5555-5555-5555-555555555555', clerk2: '66666666-6666-6666-6666-666666666666' };
await db.exec(`insert into auth.users values ${Object.values(U).map(u => `('${u}')`).join(',')}`);

// Candidate creates a campaign
await as(U.cand);
const { create_campaign: cid } = await one(`select create_campaign('Team Wanjiku', 'Jane Wanjiku', 'mp', 'Jane Wanjiku', 'Nairobi', 'Westlands') `);
ok('candidate can create a campaign', !!cid);
ok('direct insert into campaigns is blocked', await rejects(`insert into campaigns (name, candidate_name, seat) values ('x','y','mp')`));

const ward = (await one(`insert into wards (campaign_id, name, registered_voters) values ($1, 'Parklands', 40000) returning id`, [cid])).id;
const st = (await one(`insert into polling_stations (campaign_id, ward_id, code, name, registered_voters) values ($1,$2,'001','Parklands Primary',700) returning id`, [cid, ward])).id;
await db.query(`insert into members (campaign_id, user_id, full_name, role) values ($1,$2,'Fin Lead','finance')`, [cid, U.fin]);
await db.query(`insert into members (campaign_id, user_id, full_name, role, ward_id) values ($1,$2,'Coord','coordinator',$3)`, [cid, U.coord, ward]);
await db.query(`insert into members (campaign_id, user_id, full_name, role) values ($1,$2,'Clerk A','clerk'),($1,$3,'Clerk B','clerk')`, [cid, U.clerk1, U.clerk2]);
ok('manager/owner cannot add a second owner', await rejects(`insert into members (campaign_id, full_name, role) values ($1,'X','owner')`, [cid]));

// Isolation: another user sees nothing
await as(U.other);
ok('outsider sees no campaigns', (await db.query(`select * from campaigns`)).rows.length === 0);
ok('outsider sees no wards', (await db.query(`select * from wards`)).rows.length === 0);
ok('outsider cannot add a ward', await rejects(`insert into wards (campaign_id, name) values ($1,'Hack')`, [cid]));

// Coordinator logs activity, adds an agent in own ward only
await as(U.coord);
const coordId = (await one(`select kp_my_member_id($1) as id`, [cid])).id;
await db.query(`insert into activities (campaign_id, member_id, ward_id, kind, people_reached) values ($1,$2,$3,'door_to_door',35)`, [cid, coordId, ward]);
ok('coordinator activity logged', (await one(`select people_reached from ward_progress where ward_id=$1`, [ward])).people_reached === 35);
const agent = (await one(`insert into members (campaign_id, full_name, role, ward_id) values ($1,'Agent K','agent',$2) returning id`, [cid, ward])).id;
ok('coordinator can add agent in own ward', !!agent);
ok('coordinator cannot add a manager', await rejects(`insert into members (campaign_id, full_name, role, ward_id) values ($1,'M','manager',$2)`, [cid, ward]));

// Money
await as(U.fin);
const budget = (await one(`insert into budgets (campaign_id, ward_id, category, amount_kes) values ($1,$2,'transport',50000) returning id`, [cid, ward])).id;
const payee = (await one(`insert into payees (campaign_id, kind, member_id, name) values ($1,'member',$2,'Agent K') returning id`, [cid, agent])).id;
ok('vendor payee cannot point at a member', await rejects(`insert into payees (campaign_id, kind, member_id, name) values ($1,'vendor',$2,'X')`, [cid, agent]));
await as(U.coord);
const d = (await one(`insert into disbursements (campaign_id, budget_id, payee_id, amount_kes, purpose, requested_by) values ($1,$2,$3,2000,'Fare to Parklands',$4) returning id`, [cid, budget, payee, coordId])).id;
ok('coordinator cannot approve (no update right)', (await db.query(`update disbursements set status='approved' where id=$1 returning id`, [d])).rows.length === 0);
await as(U.fin);
ok('amount frozen after request', await rejects(`update disbursements set amount_kes=9000 where id=$1`, [d]));
ok('cannot jump straight to paid', await rejects(`update disbursements set status='paid', mpesa_ref='X' where id=$1`, [d]));
await db.query(`update disbursements set status='approved' where id=$1`, [d]);
ok('paid needs M-Pesa ref', await rejects(`update disbursements set status='paid' where id=$1`, [d]));
await db.query(`update disbursements set status='paid', mpesa_ref='SKX12AB3' where id=$1`, [d]);
const row = await one(`select status, decided_by, paid_at from disbursements where id=$1`, [d]);
ok('disbursement approved and paid with decider recorded', row.status === 'paid' && row.decided_by && row.paid_at);
await db.query(`delete from disbursements where id=$1`, [d]).catch(() => {});
ok('disbursements cannot be deleted', !!(await one(`select id from disbursements where id=$1`, [d])));
const fid = (await one(`select kp_my_member_id($1) as id`, [cid])).id;
const d2 = (await one(`insert into disbursements (campaign_id, budget_id, payee_id, amount_kes, purpose, requested_by) values ($1,$2,$3,500,'Airtime',$4) returning id`, [cid, budget, payee, fid])).id;
ok('cannot approve own request', await rejects(`update disbursements set status='approved' where id=$1`, [d2]));
ok('audit log records money actions', Number((await one(`select count(*) from audit_log where entity='disbursements'`)).count) >= 3);
await db.query(`update audit_log set action='X'`).catch(() => {});
await as(null);
ok('audit log cannot be edited (even by the database owner)', await rejects(`update audit_log set action='X'`) && Number((await one(`select count(*) from audit_log where action='X'`)).count) === 0);
await as(U.fin);

// Tallying: double entry
await as(U.cand);
const ownerId = (await one(`select kp_my_member_id($1) as id`, [cid])).id;
const c1 = (await one(`insert into tally_candidates (campaign_id, name, is_ours) values ($1,'Jane Wanjiku',true) returning id`, [cid])).id;
const c2 = (await one(`insert into tally_candidates (campaign_id, name) values ($1,'Opponent') returning id`, [cid])).id;
const form = (await one(`insert into tally_forms (campaign_id, polling_station_id, photo_path, uploaded_by) values ($1,$2,'x/34a.jpg',$3) returning id`, [cid, st, ownerId])).id;
const votes = (a, b) => JSON.stringify({ [c1]: a, [c2]: b });
await as(U.clerk1);
const k1 = (await one(`select kp_my_member_id($1) as id`, [cid])).id;
await db.query(`insert into tally_entries (campaign_id, form_id, entered_by, votes, rejected) values ($1,$2,$3,$4,3)`, [cid, form, k1, votes(310, 250)]);
ok('same clerk cannot enter twice', await rejects(`insert into tally_entries (campaign_id, form_id, entered_by, votes) values ($1,$2,$3,$4)`, [cid, form, k1, votes(1, 1)]));
await as(U.clerk2);
const k2 = (await one(`select kp_my_member_id($1) as id`, [cid])).id;
await db.query(`insert into tally_entries (campaign_id, form_id, entered_by, votes, rejected) values ($1,$2,$3,$4,3)`, [cid, form, k2, votes(310, 250)]);
await as(U.cand);
ok('matching entries confirm the form', (await one(`select status from tally_forms where id=$1`, [form])).status === 'confirmed');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
