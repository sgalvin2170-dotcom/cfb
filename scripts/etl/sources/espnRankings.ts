// ESPN's hidden rankings API. Same `team.$ref` id-extraction trick as
// espnFpi.ts — matches teams by ESPN's numeric id (already stored as
// espnTeamId), no fuzzy name matching needed.
//
// Poll id 2 = AFCA Coaches Poll (confirmed against the URL the user gave:
// espn.com/college-football/rankings/_/poll/2/week/1/year/2026/seasontype/1
// — poll/2 in that URL is this same id). Season types: 1 = preseason,
// 2 = regular season, 3 = postseason.
import { env } from '../env';

const POLL_ID = '2';
const POLL_NAME = 'AFCA Coaches Poll';

const URL_TEMPLATE = (year: number, seasonType: number, week: number) =>
  `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${year}/types/${seasonType}/weeks/${week}/rankings/${POLL_ID}?lang=en&region=us`;

interface EspnRankingsResponse {
  ranks: Array<{
    current: number;
    previous?: number;
    points?: number;
    firstPlaceVotes?: number;
    team: { $ref: string };
  }>;
}

export interface PollRow {
  espnTeamId: string;
  rank: number;
  previousRank?: number;
  points?: number;
  firstPlaceVotes?: number;
}

const TEAM_ID_RE = /\/teams\/(\d+)\?/;

// A full-season ETL run resolves many CFBD weeks against the same
// underlying poll (e.g. every week currently falls back to preseason until
// the season actually starts) — cache per (year, seasonType, week) so that
// doesn't mean re-fetching the same poll a dozen times in one run.
const pollCache = new Map<string, Promise<PollRow[] | undefined>>();

async function fetchPoll(year: number, seasonType: number, week: number): Promise<PollRow[] | undefined> {
  const cacheKey = `${year}:${seasonType}:${week}`;
  if (!pollCache.has(cacheKey)) {
    pollCache.set(cacheKey, fetchPollUncached(year, seasonType, week));
  }
  return pollCache.get(cacheKey);
}

async function fetchPollUncached(year: number, seasonType: number, week: number): Promise<PollRow[] | undefined> {
  const res = await fetch(URL_TEMPLATE(year, seasonType, week), { headers: { Accept: 'application/json' } });
  if (res.status === 404) return undefined; // that poll hasn't been published yet
  if (!res.ok) {
    throw new Error(`ESPN rankings fetch failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as EspnRankingsResponse;

  const rows: PollRow[] = [];
  for (const r of json.ranks) {
    if (r.current > 25) continue; // "top 25" only — the rest is "others receiving votes"
    const idMatch = r.team.$ref.match(TEAM_ID_RE);
    if (!idMatch) continue;
    rows.push({
      espnTeamId: idMatch[1],
      rank: r.current,
      previousRank: r.previous,
      points: r.points,
      firstPlaceVotes: r.firstPlaceVotes,
    });
  }
  return rows;
}

// ESPN's regular-season "week N" poll IS the operative ranking entering
// CFBD's week N (same number, no offset) — it's released once week N-1's
// games conclude, which is why it 404s until then, but ESPN never publishes
// a "week 1" regular-season poll at all: the first post-results release is
// labeled "week 2" directly. Confirmed live 2026-09-12 by comparing
// types/2/weeks/2's headline ("AFCA Coaches Poll Week 2") and full ranking
// list against espn.com's own week-2 rankings page — they matched exactly,
// while the previously-used types/2/weeks/(N-1) endpoint (a genuine off-by-
// one bug fixed this same day) 404s permanently and was silently falling
// back to the 3-week-stale preseason poll for every week >= 2.
export async function fetchCoachesPollForWeek(cfbdWeek: number, year: number = env.season): Promise<PollRow[]> {
  if (cfbdWeek > 1) {
    const regular = await fetchPoll(year, 2, cfbdWeek);
    if (regular && regular.length > 0) return regular;
  }
  const preseason = await fetchPoll(year, 1, 1);
  return preseason ?? [];
}

export { POLL_ID, POLL_NAME };
