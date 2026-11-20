import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { failTo, requireCampaign } from '@/lib/campaign';
import { createClient } from '@/lib/supabase/server';
import { Empty, Notice, PageHeader, readNotice, type SearchParams } from '@/components/ui';
import { ROLE_LABELS, type Member, type Role, type Ward } from '@/lib/types';

async function addMember(form: FormData) {
  'use server';
  const { campaign, me } = await requireCampaign();
  const supabase = await createClient();
  const role = String(form.get('role')) as Role;
  const wardId = String(form.get('ward_id') ?? '') || null;
  const { error } = await supabase.from('members').insert({
    campaign_id: campaign.id,
    full_name: String(form.get('full_name')).trim(),
    phone: String(form.get('phone') ?? '').trim() || null,
    role,
    // Coordinators can only add agents to their own ward (enforced in the database too).
    ward_id: me.role === 'coordinator' ? me.ward_id : wardId,
  });
  if (error) failTo('/team', error.message);
  revalidatePath('/', 'layout');
  redirect('/team?ok=Team%20member%20added');
}

export default async function TeamPage({ searchParams }: { searchParams: SearchParams }) {
  const notice = await readNotice(searchParams);
  const { campaign, me } = await requireCampaign();
  const supabase = await createClient();

  const [{ data: members }, { data: wards }] = await Promise.all([
    supabase.from('members').select('*').eq('campaign_id', campaign.id).order('role').order('full_name'),
    supabase.from('wards').select('id, name').eq('campaign_id', campaign.id).order('name'),
  ]);
  const list = (members ?? []) as Member[];
  const wardList = (wards ?? []) as Pick<Ward, 'id' | 'name'>[];
  const wardName = (id: string | null) => wardList.find((w) => w.id === id)?.name ?? '—';

  const addable: Role[] =
    me.role === 'owner' || me.role === 'manager'
      ? ['manager', 'finance', 'coordinator', 'agent', 'clerk']
      : me.role === 'coordinator'
        ? ['agent']
        : [];

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Everyone on the campaign. Agents don't need a login: they will use the Telegram bot."
      />
      <Notice {...notice} />

      {addable.length > 0 && (
        <form action={addMember} className="card mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5 lg:items-end">
          <div className="col-span-2 lg:col-span-1">
            <label className="label">Full name</label>
            <input className="input" name="full_name" required />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" name="phone" placeholder="07XX XXX XXX" />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" name="role">
              {addable.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Ward</label>
            <select className="input" name="ward_id" disabled={me.role === 'coordinator'} defaultValue={me.ward_id ?? ''}>
              <option value="">Whole campaign</option>
              {wardList.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <button className="btn">Add</button>
        </form>
      )}

      {list.length === 0 ? (
        <Empty>No team members yet.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Ward</th>
                <th>Phone</th>
                <th>Login</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} className={m.active ? '' : 'opacity-50'}>
                  <td className="font-medium">{m.full_name}</td>
                  <td>{ROLE_LABELS[m.role]}</td>
                  <td>{wardName(m.ward_id)}</td>
                  <td className="text-zinc-500">{m.phone ?? '—'}</td>
                  <td className="text-zinc-500">{m.user_id ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
