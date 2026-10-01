const TZ = 'Africa/Nairobi';
export const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;
export const kesShort = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 10_000
      ? `${Math.round(n / 1000)}K`
      : n.toLocaleString('en-KE');
export const date = (d: Date | null) =>
  d ? d.toLocaleDateString('en-KE', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const dateTime = (d: Date | null) =>
  d
    ? d.toLocaleString('en-KE', {
        timeZone: TZ,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';
export const time = (d: Date) =>
  d.toLocaleTimeString('en-KE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
export function ago(d: Date | null): string {
  if (!d) return 'never';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
export const daysLeft = (d: Date | null) => (d ? Math.ceil((d.getTime() - Date.now()) / 86400_000) : null);
