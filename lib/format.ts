export function formatKickoff(startDate: string | number): string {
  const d = new Date(startDate);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Time-only, for use under a separate date-column header (see the Slate/CFB
// Games grouped-by-date layout) where the date itself is already shown once.
export function formatKickoffTime(startDate: string | number): string {
  const d = new Date(startDate);
  return d.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDateHeader(startDate: string | number): string {
  const d = new Date(startDate);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
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
