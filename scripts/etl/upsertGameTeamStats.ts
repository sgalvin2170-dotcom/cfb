// Box-score ETL step: CFBD /games/teams + /drives + /games/players ->
// InstantDB `game_team_stats`. Needs games (with `completed`/points)
// already upserted.
//
// A completed game's box score never changes, so this only fetches a week
// at all if at least one of its completed games is still missing a stats
// row — three CFBD calls per week (up from one, now that drives/field
// goals are included) would be wasteful to repeat daily for weeks already
// fully captured, and at ~15 weeks/season that's real budget (see the same
// concern already documented for the coaches step). This gate means a
// settled week costs nothing on every subsequent run; only a week with a
// newly-completed game gets re-fetched.
import { lookup } from '@instantdb/admin';

import { db, transactInChunks } from './instantAdmin';
import { recordRun } from './upsertCore';
import { env } from './env';
import {
  fetchDrives,
  fetchGamePlayerStats,
  fetchGameTeamStats,
  type CfbdGameTeamStat,
  type CfbdGameTeamStats,
} from './sources/cfbd';

function statValue(stats: CfbdGameTeamStat[], category: string): string | undefined {
  return stats.find((s) => s.category === category)?.stat;
}

function statNumber(stats: CfbdGameTeamStat[], category: string): number | undefined {
  const raw = statValue(stats, category);
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

// Sums "made/attempted" fractions across however many kickers a team used
// (almost always exactly one) — e.g. two entries "1/1" + "1/2" -> "2/3".
function sumFractions(fractions: string[]): string | undefined {
  if (fractions.length === 0) return undefined;
  let made = 0;
  let attempted = 0;
  for (const f of fractions) {
    const [m, a] = f.split('/').map(Number);
    if (Number.isNaN(m) || Number.isNaN(a)) continue;
    made += m;
    attempted += a;
  }
  return `${made}/${attempted}`;
}

async function buildDriveCounts(week: number): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    const drives = await fetchDrives(week);
    for (const d of drives) {
      const key = `${d.gameId}:${d.offense}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  } catch (err) {
    console.warn(`[game-team-stats] could not fetch drives for week ${week}:`, err);
  }
  return counts;
}

async function buildFieldGoals(week: number): Promise<Map<string, string>> {
  const fgByGameTeam = new Map<string, string>();
  try {
    const playerGames = await fetchGamePlayerStats(week);
    for (const game of playerGames) {
      for (const team of game.teams) {
        const kicking = team.categories.find((c) => c.name === 'kicking');
        const fgType = kicking?.types.find((t) => t.name === 'FG');
        const fractions = fgType?.athletes.map((a) => a.stat) ?? [];
        const summed = sumFractions(fractions);
        if (summed) fgByGameTeam.set(`${game.id}:${team.team}`, summed);
      }
    }
  } catch (err) {
    console.warn(`[game-team-stats] could not fetch player stats (field goals) for week ${week}:`, err);
  }
  return fgByGameTeam;
}

async function upsertGameTeamStats() {
  const { games, teams } = await db.query({
    games: { $: { where: { season: env.season, completed: true } }, teamStats: {} },
    teams: {},
  });
  const incomplete = (games as any[]).filter((g) => (g.teamStats?.length ?? 0) < 2);
  const weeksNeeded = [...new Set(incomplete.map((g) => g.week))].sort((a, b) => a - b);
  if (weeksNeeded.length === 0) {
    return 0;
  }

  const knownGameIds = new Set((games as any[]).map((g) => g.cfbdGameId));
  const knownTeamIds = new Set((teams as any[]).map((t) => t.cfbdTeamId));

  const now = new Date().toISOString();
  let skipped = 0;
  const txs: any[] = [];

  for (const week of weeksNeeded) {
    let weekGames: CfbdGameTeamStats[];
    try {
      weekGames = await fetchGameTeamStats(week);
    } catch (err) {
      console.warn(`[game-team-stats] could not fetch week ${week}:`, err);
      continue;
    }

    const [driveCounts, fieldGoals] = await Promise.all([buildDriveCounts(week), buildFieldGoals(week)]);

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
              thirdDownConv: statValue(teamEntry.stats, 'thirdDownEff') ?? null,
              rushingTDs: statNumber(teamEntry.stats, 'rushingTDs') ?? null,
              passingTDs: statNumber(teamEntry.stats, 'passingTDs') ?? null,
              firstDowns: statNumber(teamEntry.stats, 'firstDowns') ?? null,
              penalties: statValue(teamEntry.stats, 'totalPenaltiesYards') ?? null,
              drives: driveCounts.get(`${game.id}:${teamEntry.team}`) ?? null,
              fieldGoals: fieldGoals.get(`${game.id}:${teamEntry.team}`) ?? null,
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
