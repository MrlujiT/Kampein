import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { failTo, requireCampaign } from '@/lib/campaign';
import { createClient } from '@/lib/supabase/server';
import { Empty, Notice, PageHeader, readNotice, type SearchParams } from '@/components/ui';
import { num } from '@/lib/format';
import { CAN_MANAGE_STRUCTURE, type PollingStation, type Ward } from '@/lib/types';

const toInt = (v: FormDataEntryValue | null) => Math.max(0, parseInt(String(v ?? '0').replace(/,/g, ''), 10) || 0);

async function addWard(form: FormData) {
  'use server';
  const { campaign } = await requireCampaign();
  const supabase = await createClient();
  const share = Math.min(100, Math.max(0, Number(form.get('target_share') ?? 50))) / 100;
  const { error } = await supabase.from('wards').insert({
    campaign_id: campaign.id,
    name: String(form.get('name')).trim(),
    constituency: String(form.get('constituency') ?? '').trim() || campaign.constituency,
    county: campaign.county,
    registered_voters: toInt(form.get('registered_voters')),
    target_share: share,
  });
  if (error) failTo('/structure', error.message);
  revalidatePath('/', 'layout');
  redirect('/structure?ok=Ward%20added');
}

async function addStation(form: FormData) {
  'use server';
  const { campaign } = await requireCampaign();
  const supabase = await createClient();
  const { error } = await supabase.from('polling_stations').insert({
    campaign_id: campaign.id,
    ward_id: String(form.get('ward_id')),
    code: String(form.get('code') ?? '').trim() || null,
    name: String(form.get('name')).trim(),
    registered_voters: toInt(form.get('registered_voters')),
  });
  if (error) failTo('/structure', error.message);
  revalidatePath('/', 'layout');
  redirect('/structure?ok=Polling%20station%20added');
}

export default async function StructurePage({ searchParams }: { searchParams: SearchParams }) {
  const notice = await readNotice(searchParams);
  const { campaign, me } = await requireCampaign();
  const supabase = await createClient();
  const canEdit = CAN_MANAGE_STRUCTURE.includes(me.role);

  const [{ data: wards }, { data: stations }] = await Promise.all([
    supabase.from('wards').select('*').eq('campaign_id', campaign.id).order('name'),
    supabase.from('polling_stations').select('*').eq('campaign_id', campaign.id).order('name'),
  ]);
  const wardList = (wards ?? []) as Ward[];
  const stationList = (stations ?? []) as PollingStation[];

  return (
    <>
      <PageHeader
        title="Wards & polling stations"
        subtitle="Use IEBC registered-voter figures. Each ward's target = registered voters × your target share."
      />
      <Notice {...notice} />

      {canEdit && (
        <div className="mb-8 grid gap-4 lg:grid-cols-2">
          <form action={addWard} className="card space-y-3">
            <h2 className="font-semibold">Add ward</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="label">Ward name</label>
                <input className="input" name="name" required />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="label">Constituency</label>
                <input className="input" name="constituency" defaultValue={campaign.constituency ?? ''} />
              </div>
              <div>
                <label className="label">Registered voters</label>
                <input className="input" name="registered_voters" inputMode="numeric" required />
              </div>
              <div>
                <label className="label">Target share (%)</label>
                <input className="input" name="target_share" type="number" min={0} max={100} defaultValue={50} />
              </div>
            </div>
            <button className="btn">Add ward</button>
          </form>

          <form action={addStation} className="card space-y-3">
            <h2 className="font-semibold">Add polling station</h2>
            {wardList.length === 0 ? (
              <p className="text-sm text-zinc-500">Add a ward first.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="label">Ward</label>
                    <select className="input" name="ward_id" required>
                      {wardList.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Station name</label>
                    <input className="input" name="name" required />
                  </div>
                  <div>
                    <label className="label">IEBC code</label>
                    <input className="input" name="code" />
                  </div>
                  <div className="col-span-2">
                    <label className="label">Registered voters</label>
                    <input className="input" name="registered_voters" inputMode="numeric" />
                  </div>
                </div>
                <button className="btn">Add station</button>
              </>
            )}
          </form>
        </div>
      )}

      {wardList.length === 0 ? (
        <Empty>No wards yet.</Empty>
      ) : (
        <div className="space-y-4">
          {wardList.map((w) => {
            const sts = stationList.filter((s) => s.ward_id === w.id);
            return (
              <div key={w.id} className="card">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">
                    {w.name} <span className="text-sm font-normal text-zinc-500">{w.constituency}</span>
                  </h3>
                  <div className="text-sm text-zinc-500">
                    {num(w.registered_voters)} voters · target {num(Math.round(w.registered_voters * w.target_share))} (
                    {Math.round(w.target_share * 100)}%)
                  </div>
                </div>
                {sts.length > 0 && (
                  <table className="table mt-3">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Polling station</th>
                        <th className="text-right">Registered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sts.map((s) => (
                        <tr key={s.id}>
                          <td className="text-zinc-500">{s.code ?? '—'}</td>
                          <td>{s.name}</td>
                          <td className="text-right">{num(s.registered_voters)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
