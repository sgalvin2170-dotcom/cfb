// CollegeFootballData.com (CFBD) REST client — plain fetch rather than the
// generated `cfbd` npm client, to keep this dependency-free and predictable.
// Docs: https://api.collegefootballdata.com/api-docs.json
import { env } from '../env';

const BASE_URL = 'https://api.collegefootballdata.com';

const MAX_RATE_LIMIT_RETRIES = 4;

// CFBD's 429s are an explicit short burst-rate limiter, not the monthly call
// cap ("This is NOT related to your monthly API usage... wait a few seconds
// and retry") — surfaced by callers that fire many requests back-to-back,
// like fetchCoachCareer's one-call-per-coach loop. Retry with backoff rather
// than surfacing every burst hiccup as a hard failure.
async function cfbdGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  attempt = 0,
): Promise<T> {
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

  if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    const delayMs = 1000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return cfbdGet<T>(path, params, attempt + 1);
  }

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
  spreadOpen?: number;
  overUnder?: number;
  overUnderOpen?: number;
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

export interface CfbdCoachSeason {
  school: string;
  year: number;
  games: number;
  wins: number;
  losses: number;
  ties: number;
}

export interface CfbdCoach {
  id: number;
  firstName: string;
  lastName: string;
  hireDate?: string;
  seasons: CfbdCoachSeason[];
}

// One call covers every FBS team's current head coach for the year — CFBD
// scopes each coach's `seasons` to just the requested year here, not their
// full history (that needs fetchCoachCareer below).
export function fetchCoachesForSeason(year: number = env.season): Promise<CfbdCoach[]> {
  return cfbdGet<CfbdCoach[]>('/coaches', { year });
}

// This endpoint has no `id` filter (confirmed against the live API — it's
// silently ignored), so a coach's full multi-school career has to be looked
// up by name; the caller then re-matches on `id` to guard against a
// same-name collision returning the wrong person's history.
export function fetchCoachCareer(firstName: string, lastName: string): Promise<CfbdCoach[]> {
  return cfbdGet<CfbdCoach[]>('/coaches', { firstName, lastName });
}

export interface CfbdGameTeamStat {
  category: string;
  stat: string;
}

export interface CfbdGameTeamStatsTeam {
  teamId: number;
  team: string;
  homeAway: 'home' | 'away';
  points?: number;
  stats: CfbdGameTeamStat[];
}

export interface CfbdGameTeamStats {
  id: number;
  teams: CfbdGameTeamStatsTeam[];
}

// One call covers a whole week's box scores (confirmed against the live
// API: ~100+ games returned per call) — `gameId` looks like a documented
// filter param but is silently ignored in practice, `week` is what actually
// scopes the response, so this always fetches by week rather than per-game.
export function fetchGameTeamStats(week: number, year: number = env.season): Promise<CfbdGameTeamStats[]> {
  return cfbdGet<CfbdGameTeamStats[]>('/games/teams', { year, week, seasonType: 'regular' });
}

export interface CfbdDrive {
  gameId: number;
  offense: string;
}

// One call covers a whole week (confirmed live: 762 drives for a ~50-game
// week) — count entries grouped by (gameId, offense) for a team's drive
// count in a given game.
export function fetchDrives(week: number, year: number = env.season): Promise<CfbdDrive[]> {
  return cfbdGet<CfbdDrive[]>('/drives', { year, week, seasonType: 'regular' });
}

export interface CfbdPlayerCategoryStat {
  name: string;
  athletes: Array<{ id: string; name: string; stat: string }>;
}

export interface CfbdPlayerCategory {
  name: string;
  types: CfbdPlayerCategoryStat[];
}

export interface CfbdGamePlayerStatsTeam {
  team: string;
  categories: CfbdPlayerCategory[];
}

export interface CfbdGamePlayerStats {
  id: number;
  teams: CfbdGamePlayerStatsTeam[];
}

// Unlike /games/teams and /drives, this one only returned 31/51 games for a
// live week-1 check (some games' player box scores evidently aren't
// processed by CFBD's provider yet even after final) — expect gaps, not a
// complete set, and don't treat a missing game here as an error. Only field
// goals (kicking -> FG type, e.g. "2/3") come from this endpoint; everything
// else Post-Game Analysis needs is in /games/teams or /drives.
export function fetchGamePlayerStats(week: number, year: number = env.season): Promise<CfbdGamePlayerStats[]> {
  return cfbdGet<CfbdGamePlayerStats[]>('/games/players', { year, week, seasonType: 'regular' });
}
