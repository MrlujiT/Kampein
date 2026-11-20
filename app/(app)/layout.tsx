import Link from 'next/link';
import { requireCampaign } from '@/lib/campaign';
import { ROLE_LABELS, SEAT_LABELS } from '@/lib/types';
import { signOut } from '@/app/login/actions';

const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/structure', label: 'Wards & stations' },
  { href: '/team', label: 'Team' },
  { href: '/activities', label: 'Field activity' },
  { href: '/leaderboard', label: 'Leaderboard' },
];

const COMING = ['Budgets & payments', 'Telegram bot', 'Election-day tally'];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { campaign, me } = await requireCampaign();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-zinc-200 bg-brand-900 text-brand-50 md:w-60 md:shrink-0 md:border-b-0">
        <div className="p-5">
          <div className="text-xl font-bold tracking-tight">Kampein</div>
          <div className="mt-3 text-sm font-medium">{campaign.name}</div>
          <div className="text-xs text-brand-100/70">
            {SEAT_LABELS[campaign.seat]}
            {campaign.constituency ? ` · ${campaign.constituency}` : ''}
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-white/10">
              {n.label}
            </Link>
          ))}
          <div className="mt-4 hidden px-3 text-[11px] uppercase tracking-wide text-brand-100/50 md:block">Coming next</div>
          {COMING.map((c) => (
            <span key={c} className="hidden px-3 py-1.5 text-sm text-brand-100/40 md:block">{c}</span>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-3 text-xs md:py-5">
          <div className="font-medium">{me.full_name}</div>
          <div className="text-brand-100/70">{ROLE_LABELS[me.role]}</div>
          <form action={signOut}>
            <button className="mt-2 text-brand-100/80 underline hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-5 md:p-8">{children}</main>
    </div>
  );
}
