// Rating-source ETL step: ESPN FPI + Sagarin + FEI + TeamRankings ->
// InstantDB `ratings_raw`. All but FPI are free-text-team-named and need to
// be resolved to our canonical team before writing; games/venues/teams from
// CFBD must already be upserted. ThePredictionTracker is NOT here — it's
// per-game rather than per-team, so it's matched directly in ensemble.ts
// instead of stored in this team-centric table.
import { lookup } from '@instantdb/admin';

import { db, transactInChunks } from './instantAdmin';
import { recordRun } from './upsertCore';
import { findBestMatch, normalize } from './teamMatch';
import { env } from './env';
import { fetchEspnFpi } from './sources/espnFpi';
import { fetchSagarinRatings } from './sources/sagarin';
import { fetchFei } from './sources/fei';
import { fetchTeamRankings } from './sources/teamRankings';

interface KnownTeam {
  id: string;
  espnTeamId?: string;
}

async function fetchKnownTeams(): Promise<{ bySchool: Map<string, KnownTeam>; espnIds: Set<string> }> {
  const { teams } = await db.query({ teams: {} });
  const bySchool = new Map<string, KnownTeam>();
  const espnIds = new Set<string>();
  for (const t of teams as any[]) {
    bySchool.set(normalize(t.school), { id: t.id, espnTeamId: t.espnTeamId });
    if (t.espnTeamId) espnIds.add(t.espnTeamId);
  }
  return { bySchool, espnIds };
}

// Shared upsert path for every free-text-team-named, per-team source (all of
// them except ESPN FPI, which is id-keyed, and ThePredictionTracker, which
// is per-game — see the top-of-file comment).
async function upsertTeamCentricSource(
  source: string,
  bySchool: Map<string, KnownTeam>,
  rows: Array<{ team: string; metrics: Record<string, number> }>,
  season: number,
  asOfDate: string,
): Promise<number> {
  const scrapedAt = new Date().toISOString();
  const day = scrapedAt.slice(0, 10);

  let unmatched = 0;
  const txs = rows.flatMap(({ team, metrics }) => {
    const match = findBestMatch(team, bySchool);
    if (!match) {
      unmatched++;
      return [];
    }
    return Object.entries(metrics).map(([metricName, value]) =>
      db.tx.ratings_raw.lookup('ratingKey', `${source}:${match!.id}:${metricName}:${day}`)
        .update({ source, season, asOfDate, metricName, value, scrapedAt })
        .link({ team: match!.id }),
    );
  });

  if (unmatched > 0) {
    console.warn(`[${source}] could not match ${unmatched} team name(s) to a known FBS team`);
  }

  await transactInChunks(txs);
  return txs.length;
}

async function upsertEspnFpi(espnIds: Set<string>) {
  const rows = await fetchEspnFpi();
  const scrapedAt = new Date().toISOString();
  const day = scrapedAt.slice(0, 10);

  const txs = rows
    .filter((row) => espnIds.has(row.espnTeamId))
    .flatMap((row) =>
      Object.entries(row.metrics).map(([metricName, value]) =>
        db.tx.ratings_raw.lookup('ratingKey', `espn_fpi:${row.espnTeamId}:${metricName}:${day}`)
          .update({
            source: 'espn_fpi',
            season: env.season,
            asOfDate: row.asOfDate,
            metricName,
            value,
            scrapedAt,
          })
          .link({ team: lookup('espnTeamId', row.espnTeamId) }),
      ),
    );

  await transactInChunks(txs);
  return txs.length;
}

async function upsertSagarin(bySchool: Map<string, KnownTeam>) {
  const data = await fetchSagarinRatings();

  if (data.season !== env.season) {
    console.warn(
      `[sagarin] page shows season ${data.season} (as of "${data.asOf}"), not our target season ${env.season} — likely preseason before Sagarin has published new-season ratings yet. Storing under its own season tag; the ensemble should not pick this up until seasons match.`,
    );
  }

  return upsertTeamCentricSource(
    'sagarin',
    bySchool,
    data.teams.map((row) => ({
      team: row.team,
      metrics: { sagarin_rating: row.rating, sagarin_predictor: row.predictor },
    })),
    data.season,
    data.asOfDate,
  );
}

async function upsertFei(bySchool: Map<string, KnownTeam>) {
  const rows = await fetchFei();
  return upsertTeamCentricSource(
    'fei',
    bySchool,
    rows.map((row) => ({
      team: row.team,
      metrics: { fei: row.fei, ofei: row.ofei, dfei: row.dfei, sfei: row.sfei },
    })),
    env.season,
    new Date().toISOString(), // BCFToys doesn't publish an as-of date on the page itself
  );
}

async function upsertTeamRankings(bySchool: Map<string, KnownTeam>) {
  const rows = await fetchTeamRankings();
  return upsertTeamCentricSource(
    'team_rankings',
    bySchool,
    rows.map((row) => ({ team: row.team, metrics: { rating: row.rating } })),
    env.season,
    new Date().toISOString(), // page doesn't publish an explicit as-of date either
  );
}

export async function runRatingsIngestion() {
  const { bySchool, espnIds } = await fetchKnownTeams();

  await recordRun('espn:fpi', () => upsertEspnFpi(espnIds));
  await recordRun('sagarin:ratings', () => upsertSagarin(bySchool));
  await recordRun('fei:ratings', () => upsertFei(bySchool));
  await recordRun('team_rankings:ratings', () => upsertTeamRankings(bySchool));
}
