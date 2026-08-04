// Vertical-slice ETL step: CFBD (teams/venues/games/lines) + ESPN (logos)
// -> InstantDB. No rating sources or ensemble math yet — see the phased
// build order in the plan doc for what comes next.
import { id, lookup } from '@instantdb/admin';

import { db, transactInChunks } from './instantAdmin';
import { findBestMatch } from './teamMatch';
import { fetchEspnTeamLogos } from './sources/espnLogos';
import {
  fetchFbsTeams,
  fetchGames,
  fetchLines,
  fetchTalent,
  fetchVenues,
  type CfbdGame,
  type CfbdGameLines,
  type CfbdTeam,
  type CfbdVenue,
} from './sources/cfbd';

async function upsertTeams(teams: CfbdTeam[]) {
  const logosBySchool = await fetchEspnTeamLogos();

  const txs = teams.map((team) => {
    const logo = findBestMatch(team.school, logosBySchool);
    // Note: don't repeat cfbdTeamId (the lookup attribute) inside .update() —
    // InstantDB rejects re-setting the lookup attribute on first-time create.
    return db.tx.teams.lookup('cfbdTeamId', team.id).update({
      espnTeamId: logo?.espnId,
      school: team.school,
      mascot: team.mascot,
      abbreviation: team.abbreviation,
      conference: team.conference,
      logoUrl: logo?.logoUrl ?? team.logos?.[0],
      // CFBD's color already includes the leading '#'.
      primaryColor: team.color,
    });
  });

  await transactInChunks(txs);
  return teams.length;
}

async function upsertVenues(venues: CfbdVenue[]) {
  const txs = venues
    .filter((v) => v.id != null)
    .map((venue) =>
      db.tx.venues.lookup('cfbdVenueId', venue.id).update({
        name: venue.name,
        city: venue.city,
        state: venue.state,
        capacity: venue.capacity,
        dome: venue.dome ?? false,
        grass: venue.grass ?? false,
        lat: venue.latitude,
        lng: venue.longitude,
        elevation: venue.elevation != null ? Number(venue.elevation) : undefined,
      }),
    );

  await transactInChunks(txs);
  return txs.length;
}

// Week 1 (and other early-season slates) routinely includes FBS-vs-FCS "buy
// games." We only upsert FBS teams (/teams/fbs), so linking to an FCS
// opponent's team id would fail — .link() via lookup requires the target to
// already exist, unlike .update() via lookup, which creates on demand. Skip
// those games for now rather than fetching the full FCS team list too; the
// ensemble only needs FBS-vs-FBS matchups anyway.
async function upsertGames(games: CfbdGame[], knownTeamIds: Set<number>) {
  const [playable, skipped] = partition(
    games,
    (g) => knownTeamIds.has(g.homeId) && knownTeamIds.has(g.awayId),
  );
  if (skipped.length > 0) {
    console.warn(
      `[cfbd:games] skipping ${skipped.length} game(s) with a non-FBS opponent: ${skipped
        .map((g) => `${g.awayTeam} @ ${g.homeTeam}`)
        .join(', ')}`,
    );
  }

  const txs = playable.flatMap((game) => {
    const gameTx = db.tx.games.lookup('cfbdGameId', game.id).update({
      season: game.season,
      week: game.week,
      seasonType: game.seasonType,
      startDate: game.startDate,
      neutralSite: game.neutralSite,
    });

    const linkTx = db.tx.games.lookup('cfbdGameId', game.id).link({
      homeTeam: lookup('cfbdTeamId', game.homeId),
      awayTeam: lookup('cfbdTeamId', game.awayId),
      ...(game.venueId != null ? { venue: lookup('cfbdVenueId', game.venueId) } : {}),
    });

    return [gameTx, linkTx];
  });

  await transactInChunks(txs);
  return playable.length;
}

function partition<T>(items: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const pass: T[] = [];
  const fail: T[] = [];
  for (const item of items) (predicate(item) ? pass : fail).push(item);
  return [pass, fail];
}

// Display field only (per the plan) — not fed into the ensemble margin math.
// Empty for the current season until CFBD publishes it; degrades to 0 rows
// written rather than erroring, same as every other not-yet-available source.
async function upsertTalent(knownSchools: Set<string>) {
  const rows = await fetchTalent();
  const txs = rows
    .filter((row) => knownSchools.has(row.team))
    .map((row) =>
      db.tx.talent.lookup('talentKey', `${row.team}:${row.year}`).update({
        season: row.year,
        talentScore: row.talent,
      }).link({ team: lookup('school', row.team) }),
    );

  await transactInChunks(txs);
  return txs.length;
}

// CFBD's `spread` sign convention, confirmed against real fetched data (e.g.
// USC -38.5 at home vs a heavy underdog, TCU -7 at home vs UNC): negative
// means the HOME team is favored by that many points. ensemble.ts converts
// this to "positive = home favored" to match its own predicted-margin sign
// before comparing the two.
async function upsertOdds(
  gamesById: Map<number, CfbdGame>,
  lines: CfbdGameLines[],
  playableGameIds: Set<number>,
) {
  const now = new Date().toISOString();

  const txs = lines
    .filter((line) => gamesById.has(line.id) && playableGameIds.has(line.id) && line.lines.length > 0)
    .map((line) => {
      const preferred =
        line.lines.find((l) => l.provider?.toLowerCase() === 'consensus') ?? line.lines[0];

      return db.tx.odds.lookup('oddsKey', `${line.id}:cfbd`).update({
        source: 'cfbd',
        sportsbook: preferred.provider,
        homeSpread: preferred.spread,
        overUnder: preferred.overUnder,
        homeMoneyline: preferred.homeMoneyline,
        awayMoneyline: preferred.awayMoneyline,
        capturedAt: now,
      }).link({ game: lookup('cfbdGameId', line.id) });
    });

  await transactInChunks(txs);
  return txs.length;
}

export async function recordRun(source: string, fn: () => Promise<number>): Promise<number> {
  const startedAt = new Date().toISOString();
  try {
    const rowsWritten = await fn();
    await db.transact([
      db.tx.scrape_runs[id()].update({
        source,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: 'ok',
        rowsWritten,
      }),
    ]);
    console.log(`[${source}] ok — ${rowsWritten} rows`);
    return rowsWritten;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.transact([
      db.tx.scrape_runs[id()].update({
        source,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: 'error',
        errorMessage: message,
      }),
    ]);
    console.error(`[${source}] FAILED — ${message}`);
    throw err;
  }
}

export async function runCfbdVerticalSlice(week?: number) {
  const teams = await fetchFbsTeams();
  const knownTeamIds = new Set(teams.map((t) => t.id));
  await recordRun('cfbd:teams', () => upsertTeams(teams));
  await recordRun('cfbd:venues', () => fetchVenues().then(upsertVenues));

  const games = await fetchGames(week);
  const playableGameIds = new Set(
    games.filter((g) => knownTeamIds.has(g.homeId) && knownTeamIds.has(g.awayId)).map((g) => g.id),
  );
  await recordRun('cfbd:games', () => upsertGames(games, knownTeamIds));

  const gamesById = new Map(games.map((g) => [g.id, g]));
  const lines = await fetchLines(week);
  const oddsWritten = await recordRun('cfbd:lines', () =>
    upsertOdds(gamesById, lines, playableGameIds),
  );

  const knownSchools = new Set(teams.map((t) => t.school));
  const talentWritten = await recordRun('cfbd:talent', () => upsertTalent(knownSchools));

  return { teams: teams.length, games: playableGameIds.size, odds: oddsWritten, talent: talentWritten };
}
