import { requireCampaign } from '@/lib/campaign';
import { createClient } from '@/lib/supabase/server';
import { Empty, PageHeader, Progress } from '@/components/ui';
import { num, pct } from '@/lib/format';
import { ROLE_LABELS, type Role, type WardProgress } from '@/lib/types';

interface MemberRow {
  member_id: string;
  full_name: string;
  role: Role;
  ward_id: string | null;
  people_reached: number;
  activity_count: number;
  activities_7d: number;
}

export default async function LeaderboardPage() {
  const { campaign } = await requireCampaign();
  const supabase = await createClient();

  const [{ data: wards }, { data: members }] = await Promise.all([
    supabase.from('ward_progress').select('*').eq('campaign_id', campaign.id),
    supabase
      .from('member_leaderboard')
      .select('*')
      .eq('campaign_id', campaign.id)
      .in('role', ['coordinator', 'agent'])
      .order('people_reached', { ascending: false })
      .limit(25),
  ]);

  const wardRows = ((wards ?? []) as WardProgress[])
    .map((w) => ({ ...w, score: pct(w.people_reached, w.target_votes) }))
    .sort((a, b) => b.score - a.score || b.activities_7d - a.activities_7d);
  const memberRows = (members ?? []) as MemberRow[];
  const wardName = (id: string | null) => wardRows.find((w) => w.ward_id === id)?.name ?? '—';

  return (
    <>
      <PageHeader title="Leaderboard" subtitle="Wards ranked by people reached against target. Team ranked by people reached." />

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Wards</h2>
          {wardRows.length === 0 ? (
            <Empty>No wards yet.</Empty>
          ) : (
            <ol className="card space-y-4">
              {wardRows.map((w, i) => (
                <li key={w.ward_id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>
                      <span className="mr-2 inline-block w-5 text-zinc-400">{i + 1}</span>
                      <span className="font-medium">{w.name}</span>
                    </span>
                    <span className="text-zinc-500">{w.score}% of target</span>
                  </div>
                  <Progress value={w.score} />
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Coordinators & agents</h2>
          {memberRows.length === 0 ? (
            <Empty>No coordinators or agents yet.</Empty>
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Ward</th>
                    <th className="text-right">Reached</th>
                    <th className="text-right">This week</th>
                  </tr>
                </thead>
                <tbody>
                  {memberRows.map((m, i) => (
                    <tr key={m.member_id}>
                      <td className="text-zinc-400">{i + 1}</td>
                      <td>
                        <div className="font-medium">{m.full_name}</div>
                        <div className="text-xs text-zinc-500">{ROLE_LABELS[m.role]}</div>
                      </td>
                      <td>{wardName(m.ward_id)}</td>
                      <td className="text-right">{num(m.people_reached)}</td>
                      <td className="text-right">{num(m.activities_7d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
