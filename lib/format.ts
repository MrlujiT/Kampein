const nf = new Intl.NumberFormat('en-KE');

export const num = (n: number | null | undefined) => nf.format(n ?? 0);

export const kes = (n: number | null | undefined) => `KES ${nf.format(n ?? 0)}`;

export const pct = (part: number, whole: number) =>
  whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0;

export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
