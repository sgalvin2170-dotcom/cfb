// Sagarin's college football ratings page (sagarin.com/sports/cfsend.htm).
//
// Two things about this source found only by hitting the live page, not from
// docs: (1) its TLS cert is expired — verification is disabled for this one
// request only, via node:https directly rather than global fetch, so nothing
// else in the ETL is weakened; (2) the page's actual columns as of the 2026
// season are RATING / PREDICTOR / GOLDEN_MEAN / RECENT / STRONG_RECENT — there
// is no "ELO_CHESS" column on this particular page (that terminology may be
// specific to Sagarin's other sports). We use PREDICTOR (pure score-margin,
// closest match to what the plan called the "Predictor System") and the
// overall RATING (a synthesis of all score-based methods) as our two Sagarin
// signals instead of PREDICTOR + ELO_CHESS.
import https from 'node:https';

const URL = 'https://sagarin.com/sports/cfsend.htm';

function fetchInsecure(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { rejectUnauthorized: false, timeout: 20_000 }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(body));
      })
      .on('error', reject)
      .on('timeout', function (this: any) {
        this.destroy(new Error('Sagarin request timed out'));
      });
  });
}

export interface SagarinTeamRating {
  team: string;
  rating: number;
  predictor: number;
  goldenMean: number;
  recent: number;
  strongRecent: number;
}

export interface SagarinData {
  season: number;
  asOf: string; // raw display text, e.g. "2026 January 19 Monday - CFP National Championship Game"
  asOfDate: string; // ISO date parsed out of `asOf`, for storage in a `date` field
  homeAdvantage: {
    rating: number;
    predictor: number;
    goldenMean: number;
    recent: number;
    strongRecent: number;
  };
  teams: SagarinTeamRating[];
}

const HEADER_RE = /(?:FINAL\s+)?College Football (\d{4}) ratings through games of ([^\n<]+)/;
const HFA_RE =
  /HOME ADVANTAGE=\[\s*([\d.]+)\]\s*\[\s*([\d.]+)\]\s*\[\s*([\d.]+)\]\s*\[\s*([\d.]+)\]\s*\[\s*([\d.]+)\]/;
const ROW_RE =
  /^\s*\d+\s+(.+?)\s+[AB]\s+=\s*(-?\d+\.\d+)\s+\d+\s+\d+\s+-?\d+\.\d+\(\s*\d+\)\s+\d+\s+\d+\s+\|\s+\d+\s+\d+\s+\|\s+(-?\d+\.\d+)\s+\d+\s+\|\s+(-?\d+\.\d+)\s+\d+\s+\|\s+(-?\d+\.\d+)\s+\d+\s+\|\s+(-?\d+\.\d+)\s+\d+\s+(.+?)\s+\([AB]\)/gm;
// Pulls the leading "YYYY Month D" out of asOf text like
// "2026 January 19 Monday - CFP National Championship Game".
const ASOF_DATE_RE = /^(\d{4})\s+([A-Za-z]+)\s+(\d{1,2})/;

function parseAsOfDate(asOf: string): string {
  const m = asOf.match(ASOF_DATE_RE);
  if (!m) return new Date().toISOString();
  const [, year, monthName, day] = m;
  const parsed = new Date(`${monthName} ${day}, ${year} UTC`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function parseSagarinHtml(html: string): SagarinData {
  const headerMatch = html.match(HEADER_RE);
  if (!headerMatch) {
    throw new Error('Sagarin page format changed: could not find season header');
  }
  const hfaMatch = html.match(HFA_RE);
  if (!hfaMatch) {
    throw new Error('Sagarin page format changed: could not find HOME ADVANTAGE line');
  }

  // The page prints the same team list multiple times (by rank, by
  // conference, ...) — keep only the first (by-rank) occurrence per team.
  const seen = new Set<string>();
  const teams: SagarinTeamRating[] = [];
  for (const m of html.matchAll(ROW_RE)) {
    const team = m[1].trim();
    if (seen.has(team)) continue;
    seen.add(team);
    teams.push({
      team,
      rating: Number(m[2]),
      predictor: Number(m[3]),
      goldenMean: Number(m[4]),
      recent: Number(m[5]),
      strongRecent: Number(m[6]),
    });
  }

  const asOf = headerMatch[2].trim();
  return {
    season: Number(headerMatch[1]),
    asOf,
    asOfDate: parseAsOfDate(asOf),
    homeAdvantage: {
      rating: Number(hfaMatch[1]),
      predictor: Number(hfaMatch[2]),
      goldenMean: Number(hfaMatch[3]),
      recent: Number(hfaMatch[4]),
      strongRecent: Number(hfaMatch[5]),
    },
    teams,
  };
}

export async function fetchSagarinRatings(): Promise<SagarinData> {
  const html = await fetchInsecure(URL);
  return parseSagarinHtml(html);
}
