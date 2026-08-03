// Vertical-slice ETL step: CFBD (teams/venues/games/lines) + ESPN (logos)
// -> InstantDB. No rating sources or ensemble math yet — see the phased
// build order in the plan doc for what comes next.
import { id, lookup } from '@instantdb/admin';

import { db } from './instantAdmin';
import { findBestMatch } from './teamMatch';
import { fetchEspnTeamLogos } from './sources/espnLogos';
import {
  fetchFbsTeams,
  fetchGames,
  fetchLines,
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
    return db.tx.teams.lookup('cfbdTeamId', team.id).update({
      cfbdTeamId: team.id,
      espnTeamId: logo?.espnId,
      school: team.school,
      mascot: team.mascot,
      abbreviation: team.abbreviation,
      conference: team.conference,
      logoUrl: logo?.logoUrl ?? team.logos?.[0],
      primaryColor: team.color ? `#${team.color}` : undefined,
    });
  });

  await db.transact(txs);
  return teams.length;
}

async function upsertVenues(venues: CfbdVenue[]) {
  const txs = venues
    .filter((v) => v.id != null)
    .map((venue) =>
      db.tx.venues.lookup('cfbdVenueId', venue.id).update({
        cfbdVenueId: venue.id,
        name: venue.name,
        city: venue.city,
        state: venue.state,
        capacity: venue.capacity,
        dome: venue.dome ?? false,
        grass: venue.grass ?? false,
        lat: venue.latitude,
        lng: venue.longitude,
        elevation: venue.elevation,
      }),
    );

  await db.transact(txs);
  return txs.length;
}

async function upsertGames(games: CfbdGame[]) {
  const txs = games.flatMap((game) => {
    const gameTx = db.tx.games.lookup('cfbdGameId', game.id).update({
      cfbdGameId: game.id,
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

  await db.transact(txs);
  return games.length;
}

// v0: store the market line directly as a "pick" row with no model opinion
// yet, so the dashboard has something real to show before the ensemble
// (steps 3+ in the plan) exists. Sign convention for `spread` has NOT been
// verified against live data yet — treat marketHomeSpread as provisional
// until the ensemble math (scripts/etl/ensemble.ts, not yet built) adds a
// regression test against known historical games.
async function upsertMarketOnlyPicks(gamesById: Map<number, CfbdGame>, lines: CfbdGameLines[]) {
  const now = new Date().toISOString();

  const txs = lines
    .filter((line) => gamesById.has(line.id) && line.lines.length > 0)
    .map((line) => {
      const preferred =
        line.lines.find((l) => l.provider?.toLowerCase() === 'consensus') ?? line.lines[0];

      return db.tx.ensemble_picks[id()]
        .update({
          modelVersion: 'v0-market-only',
          rawPredictedMargin: 0,
          adjustedPredictedMargin: 0,
          marketHomeSpread: preferred.spread,
          marketTotal: preferred.overUnder,
          computedAt: now,
        })
        .link({ game: lookup('cfbdGameId', line.id) });
    });

  await db.transact(txs);
  return txs.length;
}

async function recordRun(source: string, fn: () => Promise<number>) {
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
  await recordRun('cfbd:teams', () => fetchFbsTeams().then(upsertTeams));
  await recordRun('cfbd:venues', () => fetchVenues().then(upsertVenues));

  const games = await fetchGames(week);
  await recordRun('cfbd:games', async () => upsertGames(games));

  const gamesById = new Map(games.map((g) => [g.id, g]));
  const lines = await fetchLines(week);
  await recordRun('cfbd:lines', async () => upsertMarketOnlyPicks(gamesById, lines));

  return { teams: undefined, games: games.length, lines: lines.length };
}
