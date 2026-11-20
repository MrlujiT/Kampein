import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { failTo, requireCampaign } from '@/lib/campaign';
import { createClient } from '@/lib/supabase/server';
import { Empty, Notice, PageHeader, readNotice, type SearchParams } from '@/components/ui';
import { num, when } from '@/lib/format';
import { ACTIVITY_LABELS, LEADERSHIP, type ActivityKind, type Member, type Ward } from '@/lib/types';

async function logActivity(form: FormData) {
  'use server';
  const { campaign, me } = await requireCampaign();
  const supabase = await createClient();
  const memberId = String(form.get('member_id') ?? '') || me.id;
  const { error } = await supabase.from('activities').insert({
    campaign_id: campaign.id,
    member_id: memberId,
    ward_id: String(form.get('ward_id') ?? '') || me.ward_id,
    kind: String(form.get('kind')) as ActivityKind,
    people_reached: Math.max(0, parseInt(String(form.get('people_reached') ?? '0'), 10) || 0),
    notes: String(form.get('notes') ?? '').trim() || null,
  });
  if (error) failTo('/activities', error.message);
  revalidatePath('/', 'layout');
  redirect('/activities?ok=Activity%20logged');
}

interface ActivityRow {
  id: string;
  kind: ActivityKind;
  people_reached: number;
  notes: string | null;
  occurred_at: string;
  source: string;
  members: { full_name: string } | null;
  wards: { name: string } | null;
}

export default async function ActivitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const notice = await readNotice(searchParams);
  const { campaign, me } = await requireCampaign();
  const supabase = await createClient();
  const canLogForOthers = [...LEADERSHIP, 'coordinator'].includes(me.role);

  const [{ data: rows }, { data: wards }, { data: members }] = await Promise.all([
    supabase
      .from('activities')
      .select('id, kind, people_reached, notes, occurred_at, source, members(full_name), wards(name)')
      .eq('campaign_id', campaign.id)
      .order('occurred_at', { ascending: false })
      .limit(100),
    supabase.from('wards').select('id, name').eq('campaign_id', campaign.id).order('name'),
    canLogForOthers
      ? supabase.from('members').select('id, full_name, ward_id').eq('campaign_id', campaign.id).eq('active', true).order('full_name')
      : Promise.resolve({ data: [] }),
  ]);
  const list = (rows ?? []) as unknown as ActivityRow[];
  const wardList = (wards ?? []) as Pick<Ward, 'id' | 'name'>[];
  const people = ((members ?? []) as Pick<Member, 'id' | 'full_name' | 'ward_id'>[]).filter(
    (m) => me.role !== 'coordinator' || m.ward_id === me.ward_id,
  );

  return (
    <>
      <PageHeader title="Field activity" subtitle="Door-to-door, meetings, rallies and recruitment, as logged by the team." />
      <Notice {...notice} />

      <form action={logActivity} className="card mb-8 grid grid-cols-2 gap-3 lg:grid-cols-6 lg:items-end">
        {canLogForOthers && (
          <div className="col-span-2 lg:col-span-1">
            <label className="label">Who</label>
            <select className="input" name="member_id" defaultValue={me.id}>
              {people.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Activity</label>
          <select className="input" name="kind">
            {Object.entries(ACTIVITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Ward</label>
          <select className="input" name="ward_id" defaultValue={me.ward_id ?? ''} disabled={me.role === 'coordinator'}>
            <option value="">—</option>
            {wardList.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">People reached</label>
          <input className="input" name="people_reached" type="number" min={0} defaultValue={0} />
        </div>
        <div className="col-span-2 lg:col-span-1">
          <label className="label">Notes</label>
          <input className="input" name="notes" />
        </div>
        <button className="btn">Log</button>
      </form>

      {list.length === 0 ? (
        <Empty>No activity logged yet.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Ward</th>
                <th>Activity</th>
                <th className="text-right">Reached</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-zinc-500">{when(a.occurred_at)}</td>
                  <td>{a.members?.full_name ?? '—'}</td>
                  <td>{a.wards?.name ?? '—'}</td>
                  <td>{ACTIVITY_LABELS[a.kind]}</td>
                  <td className="text-right">{num(a.people_reached)}</td>
                  <td className="text-zinc-500">{a.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
