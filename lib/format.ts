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

export function formatSpread(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}`;
}

export function confidenceColor(confidence: string | undefined): string {
  switch (confidence) {
    case 'high':
      return '#1a7f37';
    case 'medium':
      return '#9a6700';
    default:
      return '#57606a';
  }
}
