// CollegeFootballData.com (CFBD) REST client — plain fetch rather than the
// generated `cfbd` npm client, to keep this dependency-free and predictable.
// Docs: https://api.collegefootballdata.com/api-docs.json
import { env } from '../env';

const BASE_URL = 'https://api.collegefootballdata.com';

async function cfbdGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.cfbdApiKey}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`CFBD ${path} failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}

export interface CfbdTeam {
  id: number;
  school: string;
  mascot?: string;
  abbreviation?: string;
  conference?: string;
  color?: string;
  logos?: string[];
}

export interface CfbdVenue {
  id: number;
  name: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  // CFBD's API actually returns this as a numeric string (e.g. "241.7"), not
  // a number — found by hitting the real endpoint, not from the docs.
  elevation?: string;
  capacity?: number;
  grass?: boolean;
  dome?: boolean;
}

export interface CfbdGame {
  id: number;
  season: number;
  week: number;
  seasonType: string;
  startDate: string;
  neutralSite: boolean;
  venue?: string;
  venueId?: number;
  homeId: number;
  homeTeam: string;
  awayId: number;
  awayTeam: string;
}

export interface CfbdLine {
  provider: string;
  spread?: number;
  overUnder?: number;
  homeMoneyline?: number;
  awayMoneyline?: number;
}

export interface CfbdGameLines {
  id: number;
  homeTeamId: number;
  awayTeamId: number;
  lines: CfbdLine[];
}

export function fetchFbsTeams(): Promise<CfbdTeam[]> {
  return cfbdGet<CfbdTeam[]>('/teams/fbs', { year: env.season });
}

export function fetchVenues(): Promise<CfbdVenue[]> {
  return cfbdGet<CfbdVenue[]>('/venues');
}

export function fetchGames(week?: number): Promise<CfbdGame[]> {
  return cfbdGet<CfbdGame[]>('/games', {
    year: env.season,
    seasonType: 'regular',
    week,
  });
}

export function fetchLines(week?: number): Promise<CfbdGameLines[]> {
  return cfbdGet<CfbdGameLines[]>('/lines', {
    year: env.season,
    seasonType: 'regular',
    week,
  });
}

export interface CfbdTalent {
  year: number;
  team: string;
  talent: number;
}

// Recruiting/roster talent composite — a display field only, per the plan
// (data quality/timing is too uncertain to feed into the margin model).
// Empty for the current season until CFBD publishes it (observed: 2026 was
// empty while 2025 had 134 teams) — same resilience pattern as Sagarin.
export function fetchTalent(): Promise<CfbdTalent[]> {
  return cfbdGet<CfbdTalent[]>('/talent', { year: env.season });
}
