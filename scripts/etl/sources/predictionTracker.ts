// ThePredictionTracker.com's aggregate-of-~50-computer-systems predictions
// (thepredictiontracker.com/predncaa.php — NOT /ncaapredictions.php, which
// 404s; that guess from initial research was wrong). Like TeamRankings, a
// normal browser User-Agent is enough — no headless browser needed.
//
// Unlike every other source here, this is PER-GAME, not per-team: it's
// already the output of ~50 systems' own home/away matchup predictions, so
// there's no per-team rating to store in `ratings_raw` and no
// home-field-advantage to add — "Prediction Avg" is already a final,
// correctly-signed (positive = home favored) predicted margin for that
// specific game. Matched directly against games at ensemble-compute time by
// team name rather than persisted, since it doesn't fit the team-centric
// ratings schema (see ensemble.ts).
//
// robots.txt disallows only /blog and /*results.php — this predictions page
// is allowed, and Content-Signal explicitly permits "use=reference".
const URL = 'https://www.thepredictiontracker.com/predncaa.php';

export interface PredictionTrackerGame {
  home: string;
  road: string;
  predictionAvg?: number;
  homeWinProb?: number;
  homeCoverProb?: number;
}

function extractColumn(rowHtml: string, columnIndex: number): string {
  const m = rowHtml.match(new RegExp(`id="tableHTML_column_${columnIndex}"[^>]*>([^<]*)<`));
  return m ? m[1].trim() : '';
}

export function parsePredictionTrackerHtml(html: string): PredictionTrackerGame[] {
  const tbodyStart = html.indexOf('<tbody>');
  const tbodyEnd = html.indexOf('</tbody>');
  if (tbodyStart === -1 || tbodyEnd === -1) {
    throw new Error('ThePredictionTracker page format changed: no <tbody> found');
  }
  const tbody = html.slice(tbodyStart, tbodyEnd);

  const games: PredictionTrackerGame[] = [];
  for (const block of tbody.split('<tr').slice(1)) {
    const home = extractColumn(block, 1);
    const road = extractColumn(block, 2);
    if (!home || !road) continue;

    const avgStr = extractColumn(block, 6);
    const homeWinsStr = extractColumn(block, 11);
    const homeCoversStr = extractColumn(block, 12);

    games.push({
      home,
      road,
      predictionAvg: avgStr ? Number(avgStr) : undefined,
      homeWinProb: homeWinsStr ? Number(homeWinsStr) : undefined,
      homeCoverProb: homeCoversStr ? Number(homeCoversStr) : undefined,
    });
  }
  return games;
}

export async function fetchPredictionTracker(): Promise<PredictionTrackerGame[]> {
  const res = await fetch(URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) {
    throw new Error(`ThePredictionTracker fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const games = parsePredictionTrackerHtml(html);
  if (games.length === 0) {
    throw new Error('ThePredictionTracker page format changed: no rows parsed');
  }
  return games;
}
