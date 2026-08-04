// Ensemble: blends whichever core rating sources have data for a given
// game, converted to a common "predicted home margin" scale, compared
// against the market spread for an ATS pick. Totals come from FEI's
// matchup formula (the only source that naturally produces one). Moneyline
// picks compare our margin-implied win probability against the devigged
// market probability.
//
// Uses fitted weights from `model_weights` (modelVersion=v2-fitted) when
// present — see scripts/train/backfill2025.ts — falling back to a plain
// equal-weight average for any source that wasn't part of that backtest
// (currently ThePredictionTracker, which has no scrapable historical
// archive to backtest against) or if v2 hasn't been trained yet.
import { lookup } from '@instantdb/admin';

import { db, transactInChunks } from './instantAdmin';
import { recordRun } from './upsertCore';
import { env } from './env';
import { findBestMatch, normalize } from './teamMatch';
import { TEAM_RANKINGS_HFA } from './sources/teamRankings';
import { fetchPredictionTracker, type PredictionTrackerGame } from './sources/predictionTracker';
import { blendMargin, computeMarginContributions, type MarginContribution, type SagarinHfa } from './marginModel';

const MODEL_VERSION = 'v1-equal-weight'; // overridden per-pick below if v2 weights are loaded
const V2_MODEL_VERSION = 'v2-fitted';

// NCAA FBS game-margin standard deviation is meaningfully wider than the
// NFL's (more competitive imbalance); this is a documented ballpark, not a
// backtested figure. Plan step 7 replaces this with the ensemble's own
// residual stdev once there's a season of results to fit against.
const MARGIN_TO_PROB_SIGMA = 16;

// Edges smaller than this aren't worth flagging as a moneyline value pick.
const ML_EDGE_THRESHOLD = 0.05;

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation, ~1e-7 max error — plenty for
  // turning a point-margin into a rough win probability.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x: number, sigma: number): number {
  return 0.5 * (1 + erf(x / (sigma * Math.SQRT2)));
}

function americanOddsToImpliedProb(odds: number): number {
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

// Proportional devig: strips the sportsbook's built-in margin so the two
// sides' implied probabilities sum to 1 instead of >1.
function devigTwoWay(homeOdds: number, awayOdds: number): { home: number; away: number } {
  const impliedHome = americanOddsToImpliedProb(homeOdds);
  const impliedAway = americanOddsToImpliedProb(awayOdds);
  const total = impliedHome + impliedAway;
  return { home: impliedHome / total, away: impliedAway / total };
}

// ThePredictionTracker is per-game, not per-team, so it can't live in
// ratings_raw like the others — fetched fresh here and matched to this
// week's games by team name, keyed by the pair so a mismatched single-team
// lookup (e.g. two different "State" schools) can't silently cross-wire two
// unrelated games.
async function fetchPredictionTrackerByGamePair(
  teamsInPlay: Map<string, { id: string }>,
): Promise<Map<string, PredictionTrackerGame>> {
  try {
    const games = await fetchPredictionTracker();
    const byPair = new Map<string, PredictionTrackerGame>();
    let unmatched = 0;
    for (const g of games) {
      const home = findBestMatch(g.home, teamsInPlay);
      const road = findBestMatch(g.road, teamsInPlay);
      if (!home || !road) {
        unmatched++;
        continue;
      }
      byPair.set(`${home.id}:${road.id}`, g);
    }
    if (unmatched > 0) {
      console.warn(`[predtracker] could not match ${unmatched} game(s) to teams in this week's slate`);
    }
    return byPair;
  } catch (err) {
    console.warn('[ensemble] could not fetch ThePredictionTracker:', err);
    return new Map();
  }
}

async function fetchSagarinHfa(): Promise<SagarinHfa | undefined> {
  try {
    const { fetchSagarinRatings } = await import('./sources/sagarin');
    const data = await fetchSagarinRatings();
    if (data.season !== env.season) return undefined; // stale off-season page, don't use its HFA either
    return { predictor: data.homeAdvantage.predictor, rating: data.homeAdvantage.rating };
  } catch (err) {
    console.warn('[ensemble] could not refresh Sagarin home-advantage constants:', err);
    return undefined;
  }
}

async function loadV2Weights(): Promise<{ weights: Map<string, number>; intercept: number } | undefined> {
  const { model_weights } = await db.query({
    model_weights: { $: { where: { modelVersion: V2_MODEL_VERSION } } },
  });
  if (!model_weights || model_weights.length === 0) return undefined;

  const weights = new Map<string, number>();
  let intercept = 0;
  for (const w of model_weights as any[]) {
    if (w.sourceName === 'intercept') intercept = w.weight;
    else weights.set(w.sourceName, w.weight);
  }
  return { weights, intercept };
}

function confidenceTier(absEdge: number, thresholds: { high: number; medium: number }): string {
  if (absEdge >= thresholds.high) return 'high';
  if (absEdge >= thresholds.medium) return 'medium';
  return 'low';
}

export async function runEnsemble(week?: number) {
  const sagarinHfa = await fetchSagarinHfa();
  const v2Weights = await loadV2Weights();
  const modelVersion = v2Weights ? V2_MODEL_VERSION : MODEL_VERSION;

  const { games } = await db.query({
    games: {
      $: { where: week != null ? { season: env.season, week } : { season: env.season } },
      homeTeam: { ratings: {} },
      awayTeam: { ratings: {} },
      odds: {},
      weatherForecasts: {},
    },
  });

  const teamsInPlay = new Map<string, { id: string }>();
  for (const g of games as any[]) {
    if (g.homeTeam) teamsInPlay.set(normalize(g.homeTeam.school), { id: g.homeTeam.id });
    if (g.awayTeam) teamsInPlay.set(normalize(g.awayTeam.school), { id: g.awayTeam.id });
  }
  const predTrackerByPair = await fetchPredictionTrackerByGamePair(teamsInPlay);

  const now = new Date().toISOString();
  let computed = 0;
  let skippedNoSources = 0;

  const txs = (games as any[]).flatMap((game) => {
    const { contributions, predictedTotal } = computeMarginContributions(
      game.homeTeam?.ratings ?? [],
      game.awayTeam?.ratings ?? [],
      env.season,
      sagarinHfa,
      TEAM_RANKINGS_HFA,
    );

    // Already a final predicted margin (aggregate of ~50 systems) — no HFA
    // to add, and no per-team lookup needed since it's matched by game pair.
    const predTracker = predTrackerByPair.get(`${game.homeTeam?.id}:${game.awayTeam?.id}`);
    if (predTracker?.predictionAvg != null) {
      contributions.push({ source: 'predictiontracker', margin: predTracker.predictionAvg });
    }

    if (contributions.length === 0) {
      skippedNoSources++;
      return [];
    }

    const predictedMargin = blendMargin(contributions, v2Weights?.weights, v2Weights?.intercept)!;

    const odds = game.odds?.[0];
    // Flip CFBD's convention (negative = home favored) to ours (positive =
    // home favored) so the two are directly comparable.
    const marketHomeMargin = odds?.homeSpread != null ? -odds.homeSpread : undefined;

    let atsPick: string | undefined;
    let atsConfidence: string | undefined;
    if (marketHomeMargin != null) {
      const edge = predictedMargin - marketHomeMargin;
      atsPick = edge > 0 ? 'home' : 'away';
      atsConfidence = confidenceTier(Math.abs(edge), { high: 3, medium: 1 });
    }

    let totalPick: string | undefined;
    let totalConfidence: string | undefined;
    if (predictedTotal != null && odds?.overUnder != null) {
      const edge = predictedTotal - odds.overUnder;
      totalPick = edge > 0 ? 'over' : 'under';
      totalConfidence = confidenceTier(Math.abs(edge), { high: 6, medium: 2 });
    }

    // Wind is the primary weather lever for scoring suppression (per the
    // plan) — downgrade the total's confidence rather than shift the point
    // estimate itself, since the effect is real but too situational
    // (dome/indoor teams unused to it, pass- vs run-heavy offenses, etc.) to
    // model as a clean linear adjustment.
    const weather = game.weatherForecasts?.[0];
    let windNote: string | undefined;
    if (totalConfidence && weather?.windMph != null) {
      if (weather.windMph >= 20) {
        totalConfidence = 'low';
        windNote = `high wind (${weather.windMph}mph) forced total confidence to low`;
      } else if (weather.windMph >= 15 && totalConfidence !== 'low') {
        totalConfidence = totalConfidence === 'high' ? 'medium' : 'low';
        windNote = `wind (${weather.windMph}mph) downgraded total confidence`;
      }
    }

    const predictedHomeWinProb = normalCdf(predictedMargin, MARGIN_TO_PROB_SIGMA);

    let mlPick: string | undefined;
    let mlEdge: number | undefined;
    let marketImpliedHomeProb: number | undefined;
    if (odds?.homeMoneyline != null && odds?.awayMoneyline != null) {
      const devigged = devigTwoWay(odds.homeMoneyline, odds.awayMoneyline);
      marketImpliedHomeProb = devigged.home;
      mlEdge = predictedHomeWinProb - devigged.home;
      if (mlEdge > ML_EDGE_THRESHOLD) mlPick = 'home';
      else if (mlEdge < -ML_EDGE_THRESHOLD) mlPick = 'away';
    }

    computed++;
    return [
      db.tx.ensemble_picks.lookup('pickKey', `${modelVersion}:${game.cfbdGameId}`)
        .update({
          modelVersion,
          rawPredictedMargin: predictedMargin,
          adjustedPredictedMargin: predictedMargin,
          predictedTotal,
          predictedHomeWinProb,
          marketHomeSpread: odds?.homeSpread,
          marketTotal: odds?.overUnder,
          marketImpliedHomeProb,
          atsPick,
          atsConfidence,
          totalPick,
          totalConfidence,
          mlPick,
          mlEdge,
          adjustmentNotes: `blend of ${contributions.length} margin source(s) (${v2Weights ? 'fitted weights' : 'equal weight'}): ${contributions
            .map((c: MarginContribution) => c.source)
            .join(', ')}${predictedTotal != null ? '; total from fei' : ''}${windNote ? `; ${windNote}` : ''}`,
          computedAt: now,
        })
        .link({ game: lookup('cfbdGameId', game.cfbdGameId) }),
    ];
  });

  await transactInChunks(txs);
  console.log(
    `[ensemble] (${modelVersion}) computed ${computed} pick(s), skipped ${skippedNoSources} game(s) with no available rating source`,
  );
  return computed;
}

export async function runEnsembleWithLogging(week?: number) {
  return recordRun('ensemble', () => runEnsemble(week));
}
