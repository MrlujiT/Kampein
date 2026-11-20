import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Campaign, Member } from '@/lib/types';

export const CAMPAIGN_COOKIE = 'kp_campaign';

export interface Session {
  campaign: Campaign;
  me: Member;
  campaigns: Pick<Campaign, 'id' | 'name'>[];
}

/**
 * The signed-in user's current campaign and their membership in it.
 * Sends them to /login or /onboarding when there is nothing to show.
 */
export async function requireCampaign(): Promise<Session> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: memberships } = await supabase
    .from('members')
    .select('*, campaigns(*)')
    .eq('user_id', user.id)
    .eq('active', true);

  if (!memberships || memberships.length === 0) redirect('/onboarding');

  const wanted = (await cookies()).get(CAMPAIGN_COOKIE)?.value;
  const current = memberships.find((m) => m.campaign_id === wanted) ?? memberships[0];
  const { campaigns: campaign, ...me } = current as Member & { campaigns: Campaign };

  return {
    campaign,
    me,
    campaigns: memberships.map((m) => ({ id: m.campaigns.id, name: m.campaigns.name })),
  };
}

/** Turns a Supabase error into a redirect back to the page with a message. */
export function failTo(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}
