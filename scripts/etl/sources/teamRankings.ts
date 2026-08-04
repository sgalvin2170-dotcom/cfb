// TeamRankings' predictive power ratings. Despite an earlier plain fetch
// getting a 403, a normal browser User-Agent is all that's needed here — no
// headless browser required. Already point-margin scaled (top-to-bottom
// FBS spread is ~60 points, consistent with a full-season power rating),
// so no regression calibration needed, just a home-field-advantage add-on.
const URL = 'https://www.teamrankings.com/college-football/ranking/predictive-by-other';

// TeamRankings doesn't publish its own HFA constant anywhere on the page;
// reusing ESPN's documented figure as a stand-in, same as FEI.
export const TEAM_RANKINGS_HFA = 2.15;

export interface TeamRankingsRow {
  team: string; // abbreviated, e.g. "Ohio St" — caller must expand "St" -> "State" before matching
  rating: number;
}

export function parseTeamRankingsHtml(html: string): TeamRankingsRow[] {
  const tableEnd = html.indexOf('</tbody>');
  const tableHtml = tableEnd === -1 ? html : html.slice(0, tableEnd);

  const rows: TeamRankingsRow[] = [];
  for (const block of tableHtml.split('<tr class="').slice(1)) {
    const teamMatch = block.match(/<a href="[^"]*">([^<]+)<\/a>/);
    const ratingMatch = block.match(/<td class="text-right" data-sort="-?[\d.]*">(-?[\d.]+)<\/td>/);
    if (teamMatch && ratingMatch) {
      rows.push({ team: teamMatch[1].trim(), rating: Number(ratingMatch[1]) });
    }
  }
  return rows;
}

// `date` (YYYY-MM-DD) pulls a historical snapshot instead of the current
// ratings — confirmed live: ?date=2026-01-15 correctly returned mid-January
// 2026 (end of the 2025 postseason) ratings, not today's. Used by the 2025
// backfill/backtest to get an end-of-season snapshot.
export async function fetchTeamRankings(date?: string): Promise<TeamRankingsRow[]> {
  const url = date ? `${URL}?date=${date}` : URL;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) {
    throw new Error(`TeamRankings fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const rows = parseTeamRankingsHtml(html);
  if (rows.length === 0) {
    throw new Error('TeamRankings page format changed: no rows parsed');
  }
  return rows;
}
