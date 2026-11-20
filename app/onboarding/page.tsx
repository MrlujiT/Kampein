import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { CAMPAIGN_COOKIE, failTo } from '@/lib/campaign';
import { Notice, readNotice, type SearchParams } from '@/components/ui';
import { SEAT_LABELS, type Seat } from '@/lib/types';

async function createCampaign(form: FormData) {
  'use server';
  const get = (k: string) => String(form.get(k) ?? '').trim() || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_campaign', {
    p_name: get('name'),
    p_candidate: get('candidate'),
    p_seat: get('seat') as Seat,
    p_owner_name: get('candidate'),
    p_county: get('county'),
    p_constituency: get('constituency'),
    p_ward: get('ward'),
  });
  if (error) failTo('/onboarding', error.message);
  (await cookies()).set(CAMPAIGN_COOKIE, data as string, { path: '/', httpOnly: true, sameSite: 'lax' });
  redirect('/dashboard');
}

export default async function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  const notice = await readNotice(searchParams);
  return (
    <main className="mx-auto max-w-lg p-6 pt-16">
      <h1 className="text-2xl font-semibold">Set up your campaign</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-500">
        You will be the candidate (owner). You can add your manager, finance lead and coordinators next.
      </p>
      <Notice {...notice} />
      <form action={createCampaign} className="card space-y-4">
        <div>
          <label className="label">Campaign name</label>
          <input className="input" name="name" placeholder="e.g. Team Wanjiku 2027" required />
        </div>
        <div>
          <label className="label">Candidate name</label>
          <input className="input" name="candidate" required />
        </div>
        <div>
          <label className="label">Seat</label>
          <select className="input" name="seat" required defaultValue="mp">
            {Object.entries(SEAT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label">County</label>
            <input className="input" name="county" />
          </div>
          <div>
            <label className="label">Constituency</label>
            <input className="input" name="constituency" />
          </div>
          <div>
            <label className="label">Ward (MCA only)</label>
            <input className="input" name="ward" />
          </div>
        </div>
        <button className="btn w-full">Create campaign</button>
      </form>
    </main>
  );
}
