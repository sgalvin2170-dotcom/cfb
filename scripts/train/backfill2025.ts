// One-time/occasional training script — NOT part of the daily ETL cron.
// Run manually: npx tsx scripts/train/backfill2025.ts
//
// Fits v2 ensemble weights by backtesting each rating source's end-of-2025
// snapshot against the full 2025 regular season's actual results. This is a
// real methodological compromise worth being upfront about: none of FPI,
// FEI, or TeamRankings expose a scrapable week-by-week historical archive,
// so "the rating as it stood before each game" isn't available — only "the
// final rating, checked against the whole season's games" is. That final
// rating already reflects how each team actually performed all season, so
// this is a biased/optimistic estimate of how well each source predicts in
// real time, not a true point-in-time backtest. It's still useful for
// *relative* weighting between sources (if FPI's final rating tracks actual
// margins much better than TeamRankings' does, that's real signal), just
// not a claim about absolute future accuracy. Sagarin is the one exception —
// its ratings_raw rows were captured by the regular daily ETL while its live
// page still showed final-2025 data, so those are genuinely already-final,
// not re-scraped for this purpose.
import { db } from '../etl/instantAdmin';
import { findBestMatch, normalize } from '../etl/teamMatch';
import { fetchFbsTeams, fetchGames, fetchLines, type CfbdGame } from '../etl/sources/cfbd';
import { fetchEspnFpi } from '../etl/sources/espnFpi';
import { fetchFei } from '../etl/sources/fei';
import { fetchTeamRankings, TEAM_RANKINGS_HFA } from '../etl/sources/teamRankings';
import { fetchEspnTeamLogos } from '../etl/sources/espnLogos';
import { fetchSagarinRatings } from '../etl/sources/sagarin';
import { computeMarginContributions, type RatingRow, type SagarinHfa } from '../etl/marginModel';
import { ridgeRegression, type RidgeResult } from './ridge';

const BACKFILL_SEASON = 2025;
// The day after Sagarin's own "final 2025" date (2026-01-19, the CFP title
// game) — confirmed live that TeamRankings' ?date= param returns a genuine
// historical snapshot, not just today's data re-labeled.
const TEAM_RANKINGS_SNAPSHOT_DATE = '2026-01-20';
const SOURCES = ['espn_fpi', 'sagarin_predictor', 'sagarin_rating', 'fei', 'team_rankings'] as const;
const HOLDOUT_START_WEEK = 11;
const LAMBDA_CANDIDATES = [0, 1, 5, 10, 20, 50, 100, 200];

interface TrainingRow {
  week: number;
  actualMargin: number;
  marketHomeMargin?: number;
  contributions: { source: string; margin: number }[];
}

function toXY(rows: TrainingRow[]): { X: number[][]; y: number[] } {
  const X = rows.map((r) => SOURCES.map((s) => r.contributions.find((c) => c.source === s)!.margin));
  const y = rows.map((r) => r.actualMargin);
  return { X, y };
}

function predict(fit: RidgeResult, x: number[]): number {
  return fit.intercept + x.reduce((sum, v, i) => sum + v * fit.coefficients[i], 0);
}

function pickLambdaByCV(X: number[][], y: number[], candidates: number[]): number {
  const K = 5;
  const n = X.length;
  const indices = [...Array(n).keys()];
  let bestLambda = candidates[0];
  let bestMse = Infinity;

  for (const lambda of candidates) {
    let totalSqErr = 0;
    let count = 0;
    for (let k = 0; k < K; k++) {
      const testIdx = indices.filter((i) => i % K === k);
      const trainIdx = indices.filter((i) => i % K !== k);
      if (testIdx.length === 0 || trainIdx.length === 0) continue;
      const fit = ridgeRegression(
        trainIdx.map((i) => X[i]),
        trainIdx.map((i) => y[i]),
        lambda,
      );
      for (const i of testIdx) {
        totalSqErr += (predict(fit, X[i]) - y[i]) ** 2;
        count++;
      }
    }
    const mse = totalSqErr / count;
    if (mse < bestMse) {
      bestMse = mse;
      bestLambda = lambda;
    }
  }
  return bestLambda;
}

// ATS accuracy using the RAW fitted coefficients (not the clipped/renormalized
// production weights) — this evaluates the statistical fit itself. The
// production weights (clipped to >=0, renormalized to sum to 1, for the
// weighted-average interpretation blendMargin() uses) can differ slightly if
// any raw coefficient came out negative, so treat this as a close estimate
// of production behavior, not an exact one.
function evaluateAts(rows: TrainingRow[], fit: RidgeResult): { correct: number; total: number } {
  let correct = 0;
  let total = 0;
  for (const r of rows) {
    if (r.marketHomeMargin == null || r.actualMargin === r.marketHomeMargin) continue; // no line, or a push
    const x = SOURCES.map((s) => r.contributions.find((c) => c.source === s)!.margin);
    const edge = predict(fit, x) - r.marketHomeMargin;
    const pickedHome = edge > 0;
    const actualCoveredHome = r.actualMargin > r.marketHomeMargin;
    if (pickedHome === actualCoveredHome) correct++;
    total++;
  }
  return { correct, total };
}

async function main() {
  console.log(`Backfilling ${BACKFILL_SEASON} season for v2 weight training...`);

  const teams = await fetchFbsTeams(BACKFILL_SEASON);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const bySchoolName = new Map(teams.map((t) => [normalize(t.school), { id: t.id }]));
  console.log(`${teams.length} FBS teams in ${BACKFILL_SEASON}`);

  const allGames = await fetchGames(undefined, BACKFILL_SEASON);
  const completedGames = allGames.filter(
    (g: CfbdGame) =>
      g.completed && g.homePoints != null && g.awayPoints != null && teamById.has(g.homeId) && teamById.has(g.awayId),
  );
  const weeks = [...new Set(completedGames.map((g) => g.week))].sort((a, b) => a - b);
  console.log(`${completedGames.length} completed FBS-vs-FBS games across weeks ${weeks[0]}-${weeks[weeks.length - 1]}`);

  const lines = await fetchLines(undefined, BACKFILL_SEASON);
  const lineByGameId = new Map(lines.map((l) => [l.id, l]));

  // ESPN FPI -> keyed by CFBD team id via espnTeamId (stable across seasons)
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
  console.log(`FPI: matched ${fpiByTeam.size}/${teams.length} teams`);

  // FEI -> keyed by CFBD team id via name matching
  const feiRows = await fetchFei(BACKFILL_SEASON);
  const feiByTeam = new Map<number, RatingRow[]>();
  let feiUnmatched = 0;
  const feiScrapedAt = new Date().toISOString();
  for (const row of feiRows) {
    const match = findBestMatch(row.team, bySchoolName);
    if (!match) {
      feiUnmatched++;
      continue;
    }
    feiByTeam.set(match.id, [
      { source: 'fei', season: BACKFILL_SEASON, metricName: 'ofei', value: row.ofei, scrapedAt: feiScrapedAt },
      { source: 'fei', season: BACKFILL_SEASON, metricName: 'dfei', value: row.dfei, scrapedAt: feiScrapedAt },
    ]);
  }
  console.log(`FEI: matched ${feiByTeam.size}/${teams.length} teams (${feiUnmatched} unmatched)`);

  // TeamRankings end-of-2025 snapshot -> keyed by CFBD team id via name matching
  const trRows = await fetchTeamRankings(TEAM_RANKINGS_SNAPSHOT_DATE);
  const trByTeam = new Map<number, RatingRow[]>();
  let trUnmatched = 0;
  const trScrapedAt = new Date().toISOString();
  for (const row of trRows) {
    const match = findBestMatch(row.team, bySchoolName);
    if (!match) {
      trUnmatched++;
      continue;
    }
    trByTeam.set(match.id, [
      { source: 'team_rankings', season: BACKFILL_SEASON, metricName: 'rating', value: row.rating, scrapedAt: trScrapedAt },
    ]);
  }
  console.log(`TeamRankings: matched ${trByTeam.size}/${teams.length} teams (${trUnmatched} unmatched)`);

  // Sagarin -> from OUR OWN ratings_raw, captured by the regular daily ETL
  // while the live page still showed final-2025 data (see file header).
  const { ratings_raw: sagarinRows } = await db.query({
    ratings_raw: { $: { where: { source: 'sagarin', season: BACKFILL_SEASON } }, team: {} },
  });
  const sagarinByTeam = new Map<number, RatingRow[]>();
  for (const r of sagarinRows as any[]) {
    const cfbdId = r.team?.cfbdTeamId;
    if (cfbdId == null) continue;
    if (!sagarinByTeam.has(cfbdId)) sagarinByTeam.set(cfbdId, []);
    sagarinByTeam
      .get(cfbdId)!
      .push({ source: 'sagarin', season: BACKFILL_SEASON, metricName: r.metricName, value: r.value, scrapedAt: r.scrapedAt });
  }
  console.log(`Sagarin: ${sagarinByTeam.size} teams found already in our database`);
  if (sagarinByTeam.size === 0) {
    console.warn(
      "No Sagarin 2025 data in our database yet — run `npm run etl` at least once (while Sagarin's page still shows final-2025 data, i.e. before 2026 games start) to capture it, then re-run this script. Proceeding without Sagarin for now.",
    );
  }

  const sagarinLive = await fetchSagarinRatings().catch(() => undefined);
  const sagarinHfa: SagarinHfa | undefined =
    sagarinLive?.season === BACKFILL_SEASON
      ? { predictor: sagarinLive.homeAdvantage.predictor, rating: sagarinLive.homeAdvantage.rating }
      : undefined;
  if (!sagarinHfa) {
    console.warn(
      `Sagarin's live page no longer shows ${BACKFILL_SEASON} (2026 season may have started) — its home-field-advantage constants aren't available, so Sagarin is excluded from this training run even though we have its ratings stored.`,
    );
  }

  // Build one training row per completed game with at least one source.
  const trainingRows: TrainingRow[] = [];
  for (const game of completedGames) {
    const homeRatings = [
      ...(fpiByTeam.get(game.homeId) ?? []),
      ...(sagarinByTeam.get(game.homeId) ?? []),
      ...(feiByTeam.get(game.homeId) ?? []),
      ...(trByTeam.get(game.homeId) ?? []),
    ];
    const awayRatings = [
      ...(fpiByTeam.get(game.awayId) ?? []),
      ...(sagarinByTeam.get(game.awayId) ?? []),
      ...(feiByTeam.get(game.awayId) ?? []),
      ...(trByTeam.get(game.awayId) ?? []),
    ];
    const { contributions } = computeMarginContributions(
      homeRatings,
      awayRatings,
      BACKFILL_SEASON,
      sagarinHfa,
      TEAM_RANKINGS_HFA,
    );
    if (contributions.length === 0) continue;

    const line = lineByGameId.get(game.id);
    const preferred = line?.lines.find((l) => l.provider?.toLowerCase() === 'consensus') ?? line?.lines[0];
    const marketHomeMargin = preferred?.spread != null ? -preferred.spread : undefined;

    trainingRows.push({
      week: game.week,
      actualMargin: game.homePoints! - game.awayPoints!,
      marketHomeMargin,
      contributions,
    });
  }

  // Regression needs a consistent design matrix — only keep games where
  // every candidate source has a value. This drops some games but keeps the
  // fit clean; v1/production still tolerates missing sources fine, that's
  // just not what we're fitting coefficients against here.
  const completeRows = trainingRows.filter((r) => SOURCES.every((s) => r.contributions.some((c) => c.source === s)));
  console.log(
    `${trainingRows.length} games have >=1 source; ${completeRows.length} have ALL ${SOURCES.length} sources (used for regression)`,
  );

  if (completeRows.length < 50) {
    throw new Error(
      `Only ${completeRows.length} complete training rows (need every one of ${SOURCES.join(', ')} present) — too few to fit a reliable model. This usually means Sagarin data is missing; see the warning above.`,
    );
  }

  const trainRows = completeRows.filter((r) => r.week < HOLDOUT_START_WEEK);
  const holdoutRows = completeRows.filter((r) => r.week >= HOLDOUT_START_WEEK);
  console.log(
    `Train: ${trainRows.length} games (weeks < ${HOLDOUT_START_WEEK}) | Holdout: ${holdoutRows.length} games (weeks >= ${HOLDOUT_START_WEEK})`,
  );

  const { X: trainX, y: trainY } = toXY(trainRows);
  const bestLambda = pickLambdaByCV(trainX, trainY, LAMBDA_CANDIDATES);
  console.log(`Selected ridge lambda=${bestLambda} via 5-fold CV on the training split`);

  // Honest-ish out-of-sample check: fit on train weeks only, evaluate ATS on
  // the later holdout weeks it never saw.
  const trainOnlyFit = ridgeRegression(trainX, trainY, bestLambda);
  const { correct, total } = evaluateAts(holdoutRows, trainOnlyFit);
  const holdoutAtsPct = total > 0 ? correct / total : 0;
  console.log(
    `Holdout ATS accuracy (weeks >= ${HOLDOUT_START_WEEK}, trained on earlier weeks only): ${(holdoutAtsPct * 100).toFixed(1)}% (${correct}/${total} games with a usable line, pushes excluded)`,
  );

  // Refit on the full season (train+holdout) for the weights actually used
  // in production, at the lambda chosen above.
  const { X: fullX, y: fullY } = toXY(completeRows);
  const finalFit = ridgeRegression(fullX, fullY, bestLambda);

  const clipped = finalFit.coefficients.map((c) => Math.max(0, c));
  const clippedTotal = clipped.reduce((a, b) => a + b, 0);
  const normalizedWeights = clipped.map((c) => (clippedTotal > 0 ? c / clippedTotal : 1 / SOURCES.length));

  console.log('\nFinal fitted weights (full 2025 season):');
  SOURCES.forEach((s, i) =>
    console.log(`  ${s.padEnd(18)} raw=${finalFit.coefficients[i].toFixed(4).padStart(8)}  normalized=${normalizedWeights[i].toFixed(4)}`),
  );
  console.log(`  intercept: ${finalFit.intercept.toFixed(3)}`);

  const trainedAt = new Date().toISOString();
  const txs = SOURCES.map((source, i) =>
    db.tx.model_weights.lookup('weightKey', `v2-fitted:${source}`).update({
      modelVersion: 'v2-fitted',
      sourceName: source,
      weight: normalizedWeights[i],
      trainedAt,
      backtestSampleSize: total,
      backtestATSPct: holdoutAtsPct,
    }),
  );
  txs.push(
    db.tx.model_weights.lookup('weightKey', 'v2-fitted:intercept').update({
      modelVersion: 'v2-fitted',
      sourceName: 'intercept',
      weight: finalFit.intercept,
      trainedAt,
      backtestSampleSize: total,
      backtestATSPct: holdoutAtsPct,
    }),
  );
  await db.transact(txs);
  console.log('\nStored v2-fitted weights in model_weights. The next `npm run etl` run will pick them up automatically.');
}

main().catch((err) => {
  console.error('Backfill/training failed:', err);
  process.exitCode = 1;
});
