// v1 ensemble: equal-weight blend of whichever core rating sources have data
// for a given team/season, converted to a common "predicted home margin"
// scale, compared against the market spread for an ATS pick. Totals come
// from FEI's matchup formula (the only source that naturally produces one).
// Moneyline picks compare our margin-implied win probability against the
// devigged market probability. All still v1: equal weights and a fixed
// margin-to-probability sigma, not yet fit from a backtest (see plan doc
// phase 7).
import { lookup } from '@instantdb/admin';

import { db, transactInChunks } from './instantAdmin';
import { recordRun } from './upsertCore';
import { env } from './env';
import { findBestMatch, normalize } from './teamMatch';
import { TEAM_RANKINGS_HFA } from './sources/teamRankings';
import { fetchPredictionTracker, type PredictionTrackerGame } from './sources/predictionTracker';

const MODEL_VERSION = 'v1-equal-weight';

// ESPN doesn't return its home-field-advantage constant from the API — this
// is their own documented long-run average, not something we scraped live.
// Reused as a stand-in HFA for FEI too, which doesn't publish its own.
const ESPN_HFA = 2.15;

// FEI publishes opponent-adjusted points-per-possession above average, not a
// score prediction — turning that into a score needs a possessions/game and
// a league-average-points assumption that the page itself doesn't provide.
// Both are reasonable modern-FBS approximations, not scraped constants;
// revisit if predicted totals look consistently off once real totals exist
// to compare against (preseason has no actuals yet to check against).
const FEI_POSSESSIONS_PER_TEAM = 12;
const FEI_LEAGUE_AVG_POINTS = 28;

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

async function fetchSagarinHfa(): Promise<{ predictor: number; rating: number } | undefined> {
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

function confidenceTier(absEdge: number, thresholds: { high: number; medium: number }): string {
  if (absEdge >= thresholds.high) return 'high';
  if (absEdge >= thresholds.medium) return 'medium';
  return 'low';
}

// Most-recent value per metricName for one team's ratings_raw rows, since a
// team can have several same-day scrapes during dev/testing and multiple
// distinct metrics (fpi, epaoffense, ...) mixed together in one flat list.
function latestMetrics(ratings: any[], source: string, season: number): Map<string, number> {
  const bySource = ratings.filter((r) => r.source === source && r.season === season);
  const latest = new Map<string, { value: number; scrapedAt: string }>();
  for (const r of bySource) {
    const existing = latest.get(r.metricName);
    if (!existing || r.scrapedAt > existing.scrapedAt) {
      latest.set(r.metricName, { value: r.value, scrapedAt: r.scrapedAt });
    }
  }
  return new Map([...latest].map(([k, v]) => [k, v.value]));
}

export async function runEnsemble(week?: number) {
  const sagarinHfa = await fetchSagarinHfa();

  const { games } = await db.query({
    games: {
      $: { where: week != null ? { season: env.season, week } : { season: env.season } },
      homeTeam: { ratings: {} },
      awayTeam: { ratings: {} },
      odds: {},
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
    const marginContributions: Array<{ source: string; margin: number }> = [];
    let predictedTotal: number | undefined;

    const homeFpi = latestMetrics(game.homeTeam?.ratings ?? [], 'espn_fpi', env.season);
    const awayFpi = latestMetrics(game.awayTeam?.ratings ?? [], 'espn_fpi', env.season);
    if (homeFpi.has('fpi') && awayFpi.has('fpi')) {
      marginContributions.push({
        source: 'espn_fpi',
        margin: homeFpi.get('fpi')! - awayFpi.get('fpi')! + ESPN_HFA,
      });
    }

    if (sagarinHfa != null) {
      const homeSagarin = latestMetrics(game.homeTeam?.ratings ?? [], 'sagarin', env.season);
      const awaySagarin = latestMetrics(game.awayTeam?.ratings ?? [], 'sagarin', env.season);
      if (homeSagarin.has('sagarin_predictor') && awaySagarin.has('sagarin_predictor')) {
        marginContributions.push({
          source: 'sagarin_predictor',
          margin:
            homeSagarin.get('sagarin_predictor')! - awaySagarin.get('sagarin_predictor')! + sagarinHfa.predictor,
        });
      }
      if (homeSagarin.has('sagarin_rating') && awaySagarin.has('sagarin_rating')) {
        marginContributions.push({
          source: 'sagarin_rating',
          margin: homeSagarin.get('sagarin_rating')! - awaySagarin.get('sagarin_rating')! + sagarinHfa.rating,
        });
      }
    }

    const homeFei = latestMetrics(game.homeTeam?.ratings ?? [], 'fei', env.season);
    const awayFei = latestMetrics(game.awayTeam?.ratings ?? [], 'fei', env.season);
    if (
      homeFei.has('ofei') &&
      homeFei.has('dfei') &&
      awayFei.has('ofei') &&
      awayFei.has('dfei')
    ) {
      const homeScore =
        FEI_LEAGUE_AVG_POINTS + (homeFei.get('ofei')! - awayFei.get('dfei')!) * FEI_POSSESSIONS_PER_TEAM;
      const awayScore =
        FEI_LEAGUE_AVG_POINTS + (awayFei.get('ofei')! - homeFei.get('dfei')!) * FEI_POSSESSIONS_PER_TEAM;
      marginContributions.push({ source: 'fei', margin: homeScore - awayScore + ESPN_HFA });
      predictedTotal = homeScore + awayScore;
    }

    const homeTr = latestMetrics(game.homeTeam?.ratings ?? [], 'team_rankings', env.season);
    const awayTr = latestMetrics(game.awayTeam?.ratings ?? [], 'team_rankings', env.season);
    if (homeTr.has('rating') && awayTr.has('rating')) {
      marginContributions.push({
        source: 'team_rankings',
        margin: homeTr.get('rating')! - awayTr.get('rating')! + TEAM_RANKINGS_HFA,
      });
    }

    // Already a final predicted margin (aggregate of ~50 systems) — no HFA
    // to add, and no per-team lookup needed since it's matched by game pair.
    const predTracker = predTrackerByPair.get(`${game.homeTeam?.id}:${game.awayTeam?.id}`);
    if (predTracker?.predictionAvg != null) {
      marginContributions.push({ source: 'predictiontracker', margin: predTracker.predictionAvg });
    }

    if (marginContributions.length === 0) {
      skippedNoSources++;
      return [];
    }

    const predictedMargin =
      marginContributions.reduce((sum, c) => sum + c.margin, 0) / marginContributions.length;

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
      db.tx.ensemble_picks.lookup('pickKey', `${MODEL_VERSION}:${game.cfbdGameId}`)
        .update({
          modelVersion: MODEL_VERSION,
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
          adjustmentNotes: `blend of ${marginContributions.length} margin source(s): ${marginContributions
            .map((c) => c.source)
            .join(', ')}${predictedTotal != null ? '; total from fei' : ''}`,
          computedAt: now,
        })
        .link({ game: lookup('cfbdGameId', game.cfbdGameId) }),
    ];
  });

  await transactInChunks(txs);
  console.log(
    `[ensemble] computed ${computed} pick(s), skipped ${skippedNoSources} game(s) with no available rating source`,
  );
  return computed;
}

export async function runEnsembleWithLogging(week?: number) {
  return recordRun('ensemble:v1-equal-weight', () => runEnsemble(week));
}
