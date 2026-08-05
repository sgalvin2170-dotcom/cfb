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
  completed?: boolean;
  homePoints?: number;
  awayPoints?: number;
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

export function fetchFbsTeams(year: number = env.season): Promise<CfbdTeam[]> {
  return cfbdGet<CfbdTeam[]>('/teams/fbs', { year });
}

export function fetchVenues(): Promise<CfbdVenue[]> {
  return cfbdGet<CfbdVenue[]>('/venues');
}

export function fetchGames(week?: number, year: number = env.season): Promise<CfbdGame[]> {
  return cfbdGet<CfbdGame[]>('/games', {
    year,
    seasonType: 'regular',
    week,
  });
}

export function fetchLines(week?: number, year: number = env.season): Promise<CfbdGameLines[]> {
  return cfbdGet<CfbdGameLines[]>('/lines', {
    year,
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

export interface CfbdRecruitingTeam {
  year: number;
  team: string;
  rank?: number;
  points?: number;
}

// This is CFBD's ingest of the 247Sports Composite team rankings — checked
// against the live 247Sports page directly (same rank/points per team), so
// there's no need to scrape 247Sports ourselves.
export function fetchRecruitingTeams(year: number = env.season): Promise<CfbdRecruitingTeam[]> {
  return cfbdGet<CfbdRecruitingTeam[]>('/recruiting/teams', { year });
}

export interface CfbdRecruitingPlayer {
  year: number;
  committedTo?: string;
  position?: string;
  stars?: number;
  rating?: number;
}

// No `team` param -> every FBS team's signees in one call (confirmed: one
// request returns the full class, no need to loop per-team and burn through
// the free-tier call budget).
export function fetchRecruitingPlayers(year: number = env.season): Promise<CfbdRecruitingPlayer[]> {
  return cfbdGet<CfbdRecruitingPlayer[]>('/recruiting/players', { year });
}

export interface CfbdPortalEntry {
  season: number;
  firstName: string;
  lastName: string;
  position?: string;
  origin?: string;
  destination?: string;
  transferDate: string;
  rating?: number;
  stars?: number;
  eligibility?: string;
}

export function fetchTransferPortal(year: number = env.season): Promise<CfbdPortalEntry[]> {
  return cfbdGet<CfbdPortalEntry[]>('/player/portal', { year });
}

export interface CfbdRosterPlayer {
  id: string;
  team: string;
  position?: string;
}

// No `team` param -> every FBS team's roster in one call, same as
// /recruiting/players. Empty for the current season until CFBD publishes it
// (roster pages typically land closer to fall camp) — same resilience
// pattern as /talent.
export function fetchRoster(year: number): Promise<CfbdRosterPlayer[]> {
  return cfbdGet<CfbdRosterPlayer[]>('/roster', { year });
}
