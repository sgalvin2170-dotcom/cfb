// CBS Sports' 2026 returning-starters article — a real per-team table
// (confirmed 138 rows, exactly the FBS count), not just prose: Team,
// total Returning Starters, and separate named offense/defense player
// lists each prefixed with a bracketed count like "[9]". This is the
// actual literal "returning starters" figure CFBD has no equivalent
// for (see roster_continuity's doc comment) — used in preference to the
// roster-diff proxy when available.
//
// Caveat: this is a single hardcoded article for the 2026 preseason, not
// a durable year-over-year API. It won't update once the season starts
// and next year's equivalent article (if CBS publishes one) would need
// its own URL — unlike every other source in this ETL, which re-fetches
// live data on every run.
const URL =
  'https://www.cbssports.com/college-football/news/college-football-returning-production-2026-returning-starters-fbs/';

export interface CbsReturningRow {
  team: string;
  totalReturning: number;
  offenseReturning: number;
  defenseReturning: number;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

// Counts of "None" (0 returning) have no bracket at all, so a missing
// match correctly defaults to 0 rather than being treated as a parse error.
function bracketCount(cellHtml: string): number {
  const match = stripTags(cellHtml).match(/\[(\d+)\]/);
  return match ? Number(match[1]) : 0;
}

export function parseCbsReturningHtml(html: string): CbsReturningRow[] {
  const tableStart = html.indexOf('<table');
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableStart === -1 || tableEnd === -1) {
    throw new Error('CBS returning-production page format changed: no table found');
  }
  const table = html.slice(tableStart, tableEnd);

  const rows: CbsReturningRow[] = [];
  for (const rowHtml of table.split('<tr>').slice(2)) {
    // slice(2): [0] is pre-<tr> table markup, [1] is the header row.
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 5) continue;
    const [, teamCell, totalCell, offenseCell, defenseCell] = cells;
    const team = stripTags(teamCell);
    const total = Number(stripTags(totalCell));
    if (!team || Number.isNaN(total)) continue;

    rows.push({
      team,
      totalReturning: total,
      offenseReturning: bracketCount(offenseCell),
      defenseReturning: bracketCount(defenseCell),
    });
  }
  return rows;
}

export async function fetchCbsReturning(): Promise<CbsReturningRow[]> {
  const res = await fetch(URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) {
    throw new Error(`CBS returning-production fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const rows = parseCbsReturningHtml(html);
  if (rows.length === 0) {
    throw new Error('CBS returning-production page format changed: no rows parsed');
  }
  return rows;
}
