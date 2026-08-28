// One-time/occasional training script — NOT part of the daily ETL cron.
// Run manually: npx tsx scripts/train/backfillScoreSigma.ts
//
// Computes a real, data-driven standard deviation for the Monte Carlo score
// simulation (see lib/monteCarlo.ts) by comparing each 2025 completed game's
// actual final score against what the CURRENTLY DEPLOYED v2-fitted weights
// would have predicted for it — home/away scores split algebraically from
// the same predictedMargin + predictedTotal (FEI's) the live app already
// shows in Ensemble Picks.
//
// Deliberately does NOT refit weights (that's backfill2025.ts's job) and
// deliberately does NOT include Sagarin: Sagarin's home-field-advantage
// constant is only ever available by hitting its live page, which as of
// 2026-08-26 shows the 2026 season (see scripts/etl/sources/sagarin.ts) —
// there's no way to recover 2025's HFA retroactively, so backfill2025.ts
// itself can no longer fully refit either. Every game here is scored using
// whichever of espn_fpi/fei/team_rankings blendMargin() can actually
// assemble, renormalized among themselves — the same graceful degradation
// the live ensemble already falls back on for a game missing one source, so
// this is a faithful (if occasionally Sagarin-less) sample of real deployed
// behavior, not an artificially complete best case. Known limitation: these
// are the SAME weights already fit on the full 2025 season (not a fresh
// holdout split), so this sigma is measured in-sample and likely slightly
// understates true future uncertainty — same caveat backfill2025.ts already
// documents for its own ATS backtest.
import { db } from '../etl/instantAdmin';
import { findBestMatch, normalize } from '../etl/teamMatch';
import { fetchFbsTeams, fetchGames, type CfbdGame } from '../etl/sources/cfbd';
import { fetchEspnFpi } from '../etl/sources/espnFpi';
import { fetchFei } from '../etl/sources/fei';
import { fetchTeamRankings, TEAM_RANKINGS_HFA } from '../etl/sources/teamRankings';
import { fetchEspnTeamLogos } from '../etl/sources/espnLogos';
import { blendMargin, computeMarginContributions, type RatingRow } from '../etl/marginModel';

const BACKFILL_SEASON = 2025;
const TEAM_RANKINGS_SNAPSHOT_DATE = '2026-01-20';
const MODEL_VERSION = 'v2-fitted';

async function main() {
  console.log(`Computing Monte Carlo score sigma from ${BACKFILL_SEASON}, scored with the live ${MODEL_VERSION} weights...`);

  const teams = await fetchFbsTeams(BACKFILL_SEASON);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const bySchoolName = new Map(teams.map((t) => [normalize(t.school), { id: t.id }]));

  const allGames = await fetchGames(undefined, BACKFILL_SEASON);
  const completedGames = allGames.filter(
    (g: CfbdGame) =>
      g.completed && g.homePoints != null && g.awayPoints != null && teamById.has(g.homeId) && teamById.has(g.awayId),
  );
  console.log(`${completedGames.length} completed FBS-vs-FBS games in ${BACKFILL_SEASON}`);

  const espnLogos = await fetchEspnTeamLogos();
  const espnIdToCfbdId = new Map<string, number>();
  for (const t of teams) {
    const match = findBestMatch(t.school, espnLogos);
    if (match) espnIdToCfbdId.set(match.espnId, t.id);
  }
  const fpiRows = await fetchEspnFpi(BACKFILL_SEASON);
  const fpiByTeam = new Map<number, RatingRow[]>();
  for (const row of fpiRows) {
    const cfbdId = espnIdToCfbdId.get(row.espnTeamId);
    if (cfbdId == null) continue;
    fpiByTeam.set(
      cfbdId,
      Object.entries(row.metrics).map(([metricName, value]) => ({
        source: 'espn_fpi',
        season: BACKFILL_SEASON,
        metricName,
        value,
        scrapedAt: row.asOfDate,
      })),
    );
  }

  const feiRows = await fetchFei(BACKFILL_SEASON);
  const feiByTeam = new Map<number, RatingRow[]>();
  const feiScrapedAt = new Date().toISOString();
  for (const row of feiRows) {
    const match = findBestMatch(row.team, bySchoolName);
    if (!match) continue;
    feiByTeam.set(match.id, [
      { source: 'fei', season: BACKFILL_SEASON, metricName: 'ofei', value: row.ofei, scrapedAt: feiScrapedAt },
      { source: 'fei', season: BACKFILL_SEASON, metricName: 'dfei', value: row.dfei, scrapedAt: feiScrapedAt },
    ]);
  }

  const trRows = await fetchTeamRankings(TEAM_RANKINGS_SNAPSHOT_DATE);
  const trByTeam = new Map<number, RatingRow[]>();
  const trScrapedAt = new Date().toISOString();
  for (const row of trRows) {
    const match = findBestMatch(row.team, bySchoolName);
    if (!match) continue;
    trByTeam.set(match.id, [
      { source: 'team_rankings', season: BACKFILL_SEASON, metricName: 'rating', value: row.rating, scrapedAt: trScrapedAt },
    ]);
  }

  const { model_weights } = await db.query({ model_weights: { $: { where: { modelVersion: MODEL_VERSION } } } });
  const weights = new Map<string, number>();
  for (const w of model_weights as any[]) {
    if (w.sourceName === 'intercept' || w.sourceName === 'team_score_sigma') continue;
    weights.set(w.sourceName, w.weight);
  }
  const intercept = (model_weights as any[]).find((w) => w.sourceName === 'intercept')?.weight ?? 0;
  if (weights.size === 0) {
    throw new Error(`No ${MODEL_VERSION} weights found in model_weights — run backfill2025.ts first.`);
  }
  console.log(
    `Loaded live weights: ${[...weights.entries()].map(([s, w]) => `${s}=${w.toFixed(3)}`).join(', ')}, intercept=${intercept.toFixed(3)}`,
  );

  const residuals: number[] = [];
  let scored = 0;
  for (const game of completedGames) {
    const homeRatings = [
      ...(fpiByTeam.get(game.homeId) ?? []),
      ...(feiByTeam.get(game.homeId) ?? []),
      ...(trByTeam.get(game.homeId) ?? []),
    ];
    const awayRatings = [
      ...(fpiByTeam.get(game.awayId) ?? []),
      ...(feiByTeam.get(game.awayId) ?? []),
      ...(trByTeam.get(game.awayId) ?? []),
    ];
    const { contributions, predictedTotal } = computeMarginContributions(
      homeRatings,
      awayRatings,
      BACKFILL_SEASON,
      undefined,
      TEAM_RANKINGS_HFA,
    );
    if (contributions.length === 0 || predictedTotal == null) continue;

    const predictedMargin = blendMargin(contributions, weights, intercept);
    if (predictedMargin == null) continue;

    const predictedHome = (predictedTotal + predictedMargin) / 2;
    const predictedAway = (predictedTotal - predictedMargin) / 2;
    residuals.push(game.homePoints! - predictedHome, game.awayPoints! - predictedAway);
    scored++;
  }
  console.log(`Scored ${scored}/${completedGames.length} games (${residuals.length} team-game residuals)`);

  if (residuals.length < 50) {
    throw new Error(`Only ${residuals.length} residuals — too few to fit a reliable sigma.`);
  }

  const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const variance = residuals.reduce((a, r) => a + (r - mean) ** 2, 0) / (residuals.length - 1);
  const sigma = Math.sqrt(variance);
  console.log(`Team-score sigma: ${sigma.toFixed(2)} pts (mean residual ${mean.toFixed(2)}, ${residuals.length} samples)`);

  await db.transact([
    db.tx.model_weights.lookup('weightKey', `${MODEL_VERSION}:team_score_sigma`).update({
      modelVersion: MODEL_VERSION,
      sourceName: 'team_score_sigma',
      weight: sigma,
      trainedAt: new Date().toISOString(),
      backtestSampleSize: residuals.length,
    }),
  ]);
  console.log('Stored team_score_sigma in model_weights. Monte Carlo simulations will pick it up automatically.');
}

main().catch((err) => {
  console.error('Score-sigma backfill failed:', err);
  process.exitCode = 1;
});
