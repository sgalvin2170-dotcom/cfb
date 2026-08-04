// Rating-source ETL step: ESPN FPI + Sagarin -> InstantDB `ratings_raw`.
// Both are free-text/id-keyed and need to be resolved to our canonical team
// before writing; games/venues/teams from CFBD must already be upserted.
import { lookup } from '@instantdb/admin';

import { db, transactInChunks } from './instantAdmin';
import { recordRun } from './upsertCore';
import { findBestMatch, normalize } from './teamMatch';
import { env } from './env';
import { fetchEspnFpi } from './sources/espnFpi';
import { fetchSagarinRatings } from './sources/sagarin';

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
  const scrapedAt = new Date().toISOString();
  const day = scrapedAt.slice(0, 10);

  if (data.season !== env.season) {
    console.warn(
      `[sagarin] page shows season ${data.season} (as of "${data.asOf}"), not our target season ${env.season} — likely preseason before Sagarin has published new-season ratings yet. Storing under its own season tag; the ensemble should not pick this up until seasons match.`,
    );
  }

  let unmatched = 0;
  const txs = data.teams.flatMap((row) => {
    const match = findBestMatch(row.team, bySchool);
    if (!match) {
      unmatched++;
      return [];
    }
    const metrics: Record<string, number> = {
      sagarin_rating: row.rating,
      sagarin_predictor: row.predictor,
    };
    return Object.entries(metrics).map(([metricName, value]) =>
      db.tx.ratings_raw.lookup('ratingKey', `sagarin:${match!.id}:${metricName}:${day}`)
        .update({
          source: 'sagarin',
          season: data.season,
          asOfDate: data.asOfDate,
          metricName,
          value,
          scrapedAt,
        })
        .link({ team: match!.id }),
    );
  });

  if (unmatched > 0) {
    console.warn(`[sagarin] could not match ${unmatched} team name(s) to a known FBS team (expected for FCS opponents in Sagarin's 265-team list)`);
  }

  await transactInChunks(txs);
  return txs.length;
}

export async function runRatingsIngestion() {
  const { bySchool, espnIds } = await fetchKnownTeams();

  await recordRun('espn:fpi', () => upsertEspnFpi(espnIds));
  await recordRun('sagarin:ratings', () => upsertSagarin(bySchool));
}
