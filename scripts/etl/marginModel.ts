// Shared margin-normalization logic used by both the live ensemble
// (ensemble.ts) and the 2025 backtest/weight-fitting script
// (scripts/train/backfill2025.ts) — kept in one place so a backtest is
// actually testing the same math the live picks use, not a re-implementation
// that could quietly drift out of sync.
export const ESPN_HFA = 2.15;
export const FEI_POSSESSIONS_PER_TEAM = 12;
export const FEI_LEAGUE_AVG_POINTS = 28;

export interface RatingRow {
  source: string;
  season: number;
  metricName: string;
  value: number;
  scrapedAt: string;
}

export interface MarginContribution {
  source: string;
  margin: number;
}

export interface SagarinHfa {
  predictor: number;
  rating: number;
}

// Most-recent value per metricName for one team's ratings, since a team can
// have several same-day scrapes (dev/testing, or a mid-week re-run) mixed
// into one flat list alongside other sources' metrics.
export function latestMetrics(ratings: RatingRow[], source: string, season: number): Map<string, number> {
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

// Per-team-rating sources only (FPI, Sagarin, FEI, TeamRankings) —
// ThePredictionTracker is per-game, matched separately in ensemble.ts, and
// merged into the same `contributions` array by the caller if desired.
export function computeMarginContributions(
  homeRatings: RatingRow[],
  awayRatings: RatingRow[],
  season: number,
  sagarinHfa: SagarinHfa | undefined,
  teamRankingsHfa: number,
): { contributions: MarginContribution[]; predictedTotal?: number } {
  const contributions: MarginContribution[] = [];
  let predictedTotal: number | undefined;

  const homeFpi = latestMetrics(homeRatings, 'espn_fpi', season);
  const awayFpi = latestMetrics(awayRatings, 'espn_fpi', season);
  if (homeFpi.has('fpi') && awayFpi.has('fpi')) {
    contributions.push({ source: 'espn_fpi', margin: homeFpi.get('fpi')! - awayFpi.get('fpi')! + ESPN_HFA });
  }

  if (sagarinHfa != null) {
    const homeSagarin = latestMetrics(homeRatings, 'sagarin', season);
    const awaySagarin = latestMetrics(awayRatings, 'sagarin', season);
    if (homeSagarin.has('sagarin_predictor') && awaySagarin.has('sagarin_predictor')) {
      contributions.push({
        source: 'sagarin_predictor',
        margin: homeSagarin.get('sagarin_predictor')! - awaySagarin.get('sagarin_predictor')! + sagarinHfa.predictor,
      });
    }
    if (homeSagarin.has('sagarin_rating') && awaySagarin.has('sagarin_rating')) {
      contributions.push({
        source: 'sagarin_rating',
        margin: homeSagarin.get('sagarin_rating')! - awaySagarin.get('sagarin_rating')! + sagarinHfa.rating,
      });
    }
  }

  const homeFei = latestMetrics(homeRatings, 'fei', season);
  const awayFei = latestMetrics(awayRatings, 'fei', season);
  if (homeFei.has('ofei') && homeFei.has('dfei') && awayFei.has('ofei') && awayFei.has('dfei')) {
    const homeScore = FEI_LEAGUE_AVG_POINTS + (homeFei.get('ofei')! - awayFei.get('dfei')!) * FEI_POSSESSIONS_PER_TEAM;
    const awayScore = FEI_LEAGUE_AVG_POINTS + (awayFei.get('ofei')! - homeFei.get('dfei')!) * FEI_POSSESSIONS_PER_TEAM;
    contributions.push({ source: 'fei', margin: homeScore - awayScore + ESPN_HFA });
    predictedTotal = homeScore + awayScore;
  }

  const homeTr = latestMetrics(homeRatings, 'team_rankings', season);
  const awayTr = latestMetrics(awayRatings, 'team_rankings', season);
  if (homeTr.has('rating') && awayTr.has('rating')) {
    contributions.push({
      source: 'team_rankings',
      margin: homeTr.get('rating')! - awayTr.get('rating')! + teamRankingsHfa,
    });
  }

  return { contributions, predictedTotal };
}

// v1: plain average over whichever sources are available. v2 (once trained):
// pass a weights map and available contributions are combined as a weighted
// average, renormalized over just the sources present for this game — the
// same "tolerate a missing source" resilience property v1 has, just
// weighted — plus a fitted calibration intercept added unconditionally
// (it's a general bias correction, not tied to any one source's presence).
export function blendMargin(
  contributions: MarginContribution[],
  weights?: Map<string, number>,
  intercept = 0,
): number | undefined {
  if (contributions.length === 0) return undefined;
  if (!weights) {
    return contributions.reduce((sum, c) => sum + c.margin, 0) / contributions.length;
  }

  // A source with no fitted weight (currently: ThePredictionTracker, which
  // has no scrapable historical archive to backtest) isn't a source we know
  // is *bad* — it just hasn't been through the backtest yet. Defaulting it
  // to 0 would silently zero out our single highest-trust signal per the
  // plan's own framing; defaulting it to the average of the fitted weights
  // instead treats it as "presumed average" until it can be backtested too.
  const fittedValues = [...weights.values()];
  const avgFittedWeight = fittedValues.length > 0 ? fittedValues.reduce((a, b) => a + b, 0) / fittedValues.length : 0;

  let weightedSum = 0;
  let weightTotal = 0;
  for (const c of contributions) {
    const w = weights.get(c.source) ?? avgFittedWeight;
    weightedSum += w * c.margin;
    weightTotal += w;
  }
  // No fitted weight for any of today's available sources (e.g. a brand new
  // source) — fall back to an equal-weight average rather than returning 0.
  if (weightTotal === 0) {
    return contributions.reduce((sum, c) => sum + c.margin, 0) / contributions.length;
  }
  return weightedSum / weightTotal + intercept;
}
