// BCFToys' Fremeau Efficiency Index (bcftoys.com/{year}-fei). Static HTML
// table, no headless browser needed (plain fetch works, unlike TeamRankings/
// ThePredictionTracker). Values are opponent-adjusted points-per-possession
// above average — the plan's matchup formula converts OFEI/DFEI into a
// score prediction using an assumed possessions-per-game figure, since the
// page itself doesn't publish that or a league-average points constant.
import { env } from '../env';

const URL_TEMPLATE = (year: number) => `https://bcftoys.com/${year}-fei`;

export interface FeiTeamRow {
  team: string;
  fei: number;
  ofei: number;
  dfei: number;
  sfei: number;
}

// One row per team: rank, team, Rec, FBS, FEI, (blank), OFEI, Rk, DFEI, Rk, SFEI, Rk, ...
const ROW_RE =
  /<tr><td align="center">\d+<\/td><td align="left">([^<]+)<\/td><td align="center">[^<]*<\/td><td align="center">[^<]*<\/td><td align="right">(-?\.?\d+\.?\d*)<\/td><td><\/td><td align="right">(-?\.?\d+\.?\d*)<\/td><td align="center">\d+<\/td><td align="right">(-?\.?\d+\.?\d*)<\/td><td align="center">\d+<\/td><td align="right">(-?\.?\d+\.?\d*)<\/td>/g;

export function parseFeiHtml(html: string): FeiTeamRow[] {
  const rows: FeiTeamRow[] = [];
  for (const m of html.matchAll(ROW_RE)) {
    rows.push({
      team: m[1].trim(),
      fei: Number(m[2]),
      ofei: Number(m[3]),
      dfei: Number(m[4]),
      sfei: Number(m[5]),
    });
  }
  return rows;
}

export async function fetchFei(): Promise<FeiTeamRow[]> {
  const res = await fetch(URL_TEMPLATE(env.season), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cfb-predictor personal-use ETL)' },
  });
  if (!res.ok) {
    throw new Error(`BCFToys FEI fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const rows = parseFeiHtml(html);
  if (rows.length === 0) {
    throw new Error('BCFToys FEI page format changed: no rows parsed');
  }
  return rows;
}
