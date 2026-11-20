import Link from 'next/link';
import { requireCampaign } from '@/lib/campaign';
import { createClient } from '@/lib/supabase/server';
import { Empty, PageHeader, Progress, Stat } from '@/components/ui';
import { num, pct } from '@/lib/format';
import type { WardProgress } from '@/lib/types';

export default async function Dashboard() {
  const { campaign } = await requireCampaign();
  const supabase = await createClient();

  const [{ data: wards }, { count: stations }, { count: people }, { count: agents }] = await Promise.all([
    supabase.from('ward_progress').select('*').eq('campaign_id', campaign.id).order('name'),
    supabase.from('polling_stations').select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id),
    supabase.from('members').select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id).eq('active', true),
    supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .eq('active', true)
      .eq('role', 'agent'),
  ]);

  const rows = (wards ?? []) as WardProgress[];
  const registered = rows.reduce((s, w) => s + w.registered_voters, 0);
  const target = rows.reduce((s, w) => s + w.target_votes, 0);
  const reached = rows.reduce((s, w) => s + w.people_reached, 0);
  const week = rows.reduce((s, w) => s + w.activities_7d, 0);

  const daysLeft = campaign.election_date
    ? Math.ceil((new Date(campaign.election_date).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <>
      <PageHeader
        title={`Karibu, ${campaign.candidate_name.split(' ')[0]}`}
        subtitle={daysLeft !== null && daysLeft > 0 ? `${num(daysLeft)} days to the general election` : undefined}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Registered voters" value={num(registered)} hint={`${rows.length} wards · ${num(stations)} stations`} />
        <Stat label="Vote target" value={num(target)} hint="Sum of ward targets" />
        <Stat label="People reached" value={num(reached)} hint={`${pct(reached, target)}% of target`} />
        <Stat label="Team" value={num(people)} hint={`${num(agents)} agents · ${num(week)} activities this week`} />
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Wards against target</h2>
      {rows.length === 0 ? (
        <Empty>
          No wards yet. <Link className="text-brand-600 underline" href="/structure">Add your wards</Link> with their
          IEBC registered-voter numbers to set targets.
        </Empty>
      ) : (
        <div className="card space-y-4">
          {rows.map((w) => (
            <div key={w.ward_id}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium">{w.name}</span>
                <span className="text-zinc-500">
                  {num(w.people_reached)} / {num(w.target_votes)} reached · {w.activities_7d} activities this week
                </span>
              </div>
              <Progress value={pct(w.people_reached, w.target_votes)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
