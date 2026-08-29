// Box-score ETL step: CFBD /games/teams -> InstantDB `game_team_stats`.
// Needs games (with `completed`/points) already upserted. A completed
// game's box score never changes, so this is safe to re-run every day —
// idempotent upsert key, and re-fetching an old week just overwrites with
// the same values.
import { lookup } from '@instantdb/admin';

import { db, transactInChunks } from './instantAdmin';
import { recordRun } from './upsertCore';
import { env } from './env';
import { fetchGameTeamStats, type CfbdGameTeamStat, type CfbdGameTeamStats } from './sources/cfbd';

function statValue(stats: CfbdGameTeamStat[], category: string): string | undefined {
  return stats.find((s) => s.category === category)?.stat;
}

function statNumber(stats: CfbdGameTeamStat[], category: string): number | undefined {
  const raw = statValue(stats, category);
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

async function upsertGameTeamStats() {
  const { games, teams } = await db.query({
    games: { $: { where: { season: env.season, completed: true } } },
    teams: {},
  });
  const weeks = [...new Set((games as any[]).map((g) => g.week))].sort((a, b) => a - b);
  if (weeks.length === 0) {
    return 0;
  }
  const knownGameIds = new Set((games as any[]).map((g) => g.cfbdGameId));
  const knownTeamIds = new Set((teams as any[]).map((t) => t.cfbdTeamId));

  const now = new Date().toISOString();
  let skipped = 0;
  const txs: any[] = [];

  for (const week of weeks) {
    let weekGames: CfbdGameTeamStats[];
    try {
      weekGames = await fetchGameTeamStats(week);
    } catch (err) {
      console.warn(`[game-team-stats] could not fetch week ${week}:`, err);
      continue;
    }

    for (const game of weekGames) {
      // /games/teams returns every game that week, including ones we never
      // tracked (FCS-vs-FCS, etc. — see upsertGames' same skip for why) —
      // .link() via lookup throws if the target doesn't already exist, so
      // both sides need to be pre-verified rather than assumed.
      if (!knownGameIds.has(game.id)) continue;
      for (const teamEntry of game.teams) {
        if (!knownTeamIds.has(teamEntry.teamId)) {
          skipped++;
          continue;
        }
        txs.push(
          db.tx.game_team_stats
            .lookup('statsKey', `${game.id}:${teamEntry.teamId}`)
            .update({
              rushingYards: statNumber(teamEntry.stats, 'rushingYards') ?? null,
              passingYards: statNumber(teamEntry.stats, 'netPassingYards') ?? null,
              turnovers: statNumber(teamEntry.stats, 'turnovers') ?? null,
              possessionTime: statValue(teamEntry.stats, 'possessionTime') ?? null,
              computedAt: now,
            })
            .link({ game: lookup('cfbdGameId', game.id), team: lookup('cfbdTeamId', teamEntry.teamId) }),
        );
      }
    }
  }

  if (skipped > 0) {
    console.warn(`[game-team-stats] skipped ${skipped} team-stat row(s) for a non-FBS/unknown team`);
  }

  await transactInChunks(txs);
  return txs.length;
}

export async function runGameTeamStatsIngestion() {
  return recordRun('game-team-stats', upsertGameTeamStats);
}
