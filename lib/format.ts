// College football is universally scheduled/discussed in Eastern Time —
// kickoff times are shown in ET regardless of the viewer's own device
// timezone, rather than silently relabeling them to wherever the app
// happens to be viewed from.
const ET_ZONE = 'America/New_York';

export function formatKickoff(startDate: string | number): string {
  const d = new Date(startDate);
  return (
    d.toLocaleString(undefined, {
      timeZone: ET_ZONE,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }) + ' ET'
  );
}

// Time-only, for use under a separate date-column header (see the Slate/CFB
// Games grouped-by-date layout) where the date itself is already shown once.
export function formatKickoffTime(startDate: string | number): string {
  const d = new Date(startDate);
  return d.toLocaleString(undefined, { timeZone: ET_ZONE, hour: 'numeric', minute: '2-digit' }) + ' ET';
}

// Stable, sortable calendar-day key in Eastern Time (en-CA locale formats as
// YYYY-MM-DD) — used for grouping games by date so a late-night ET game
// lands in the right day's column regardless of the viewer's own device
// timezone, not just for the header label.
export function etDateKey(startDate: string | number): string {
  return new Date(startDate).toLocaleDateString('en-CA', { timeZone: ET_ZONE });
}

export function formatDateHeader(startDate: string | number): string {
  const d = new Date(startDate);
  return d.toLocaleDateString(undefined, { timeZone: ET_ZONE, weekday: 'long', month: 'short', day: 'numeric' });
}

// `null` (not just `undefined`) shows up here for real — InstantDB stores an
// explicit null to clear a field that a previous ETL run had set (plain
// `undefined` gets dropped by db.transact()'s JSON.stringify instead of
// clearing anything, see ensemble.ts), so both need the same "no value" path.
export function formatSpread(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}`;
}

// Totals (O/U) aren't a "favored by" number like a spread, so no +/- sign.
export function formatTotal(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(1);
}

export function confidenceColor(confidence: string | undefined | null): string {
  switch (confidence) {
    case 'high':
      return '#1a7f37';
    case 'medium':
      return '#9a6700';
    default:
      return '#57606a';
  }
}
