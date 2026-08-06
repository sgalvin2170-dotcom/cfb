// Poll-ranking ETL step: ESPN AFCA Coaches Poll -> InstantDB
// `poll_rankings`, one row per (team, week). Needs games already upserted
// (to know which weeks are in play this season).
import { lookup } from '@instantdb/admin';

import { db, transactInChunks } from './instantAdmin';
import { recordRun } from './upsertCore';
import { env } from './env';
import { fetchCoachesPollForWeek, POLL_ID, POLL_NAME } from './sources/espnRankings';

async function upsertPollsForWeek(week: number, espnIds: Set<string>) {
  const rows = await fetchCoachesPollForWeek(week);
  const txs = rows
    .filter((row) => espnIds.has(row.espnTeamId))
    .map((row) =>
      db.tx.poll_rankings
        .lookup('pollRankKey', `${row.espnTeamId}:${env.season}:${week}:${POLL_ID}`)
        .update({
          season: env.season,
          week,
          pollId: POLL_ID,
          pollName: POLL_NAME,
          rank: row.rank,
          previousRank: row.previousRank,
          points: row.points,
          firstPlaceVotes: row.firstPlaceVotes,
        })
        .link({ team: lookup('espnTeamId', row.espnTeamId) }),
    );

  await transactInChunks(txs);
  return txs.length;
}

async function upsertPolls(week?: number) {
  const { teams } = await db.query({ teams: {} });
  const espnIds = new Set((teams as any[]).map((t) => t.espnTeamId).filter(Boolean));

  let weeks: number[];
  if (week != null) {
    weeks = [week];
  } else {
    const { games } = await db.query({ games: { $: { where: { season: env.season } } } });
    weeks = Array.from(new Set((games as any[]).map((g) => g.week))).sort((a, b) => a - b);
  }

  let total = 0;
  for (const w of weeks) {
    total += await upsertPollsForWeek(w, espnIds);
  }
  return total;
}

export async function runPollsIngestion(week?: number) {
  return recordRun('espn:coaches-poll', () => upsertPolls(week));
}
