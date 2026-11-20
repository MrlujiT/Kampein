import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kampein',
  description: 'Campaign management for Kenyan candidates: teams, targets, money and election-day tallying.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 font-sans text-zinc-800 antialiased">{children}</body>
    </html>
  );
}
