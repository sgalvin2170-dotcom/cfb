// Monte Carlo game simulation for the Game Detail screen. Draws each team's
// score independently from Normal(mean, sigma) per trial and tallies
// empirical win/cover/over probabilities — a richer, distributional view of
// the same numbers already shown in Ensemble Picks, not a new predictive
// signal (see scripts/train/backfillScoreSigma.ts for where `sigma` comes
// from and its known limitations).
//
// Seeded off the game id so the same game always shows the same simulated
// percentages on reload instead of jittering a point or two each visit.

export const TRIALS = 10000;

// Reuses the existing 15/20mph total-confidence-downgrade thresholds
// (scripts/etl/ensemble.ts) as a variance-shrink multiplier instead of a
// confidence-tier downgrade: high wind suppresses scoring variance for both
// teams together (fewer explosive plays), not just the point estimate. This
// multiplier itself isn't separately backtested — only the base sigma is —
// so treat it as a documented, reasonable heuristic, same spirit as the wind
// thresholds it's borrowed from.
function windSigmaScale(windMph: number | undefined | null): number {
  if (windMph == null) return 1;
  if (windMph >= 20) return 0.7;
  if (windMph >= 15) return 0.85;
  return 1;
}

// mulberry32 — small, fast, seedable PRNG. Not cryptographic; doesn't need
// to be, this is just for reproducible-per-game simulation draws.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// djb2 string hash, folded into a 32-bit int for mulberry32's seed.
function hashSeed(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

// Box-Muller transform: two uniform draws -> one standard normal draw.
function randomNormal(rand: () => number): number {
  const u1 = Math.max(rand(), Number.EPSILON);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface MonteCarloInput {
  gameId: string;
  homeMean: number;
  awayMean: number;
  sigma: number;
  windMph?: number | null;
  marketHomeSpread?: number | null; // CFBD convention: negative = home favored
  marketTotal?: number | null;
  trials?: number;
}

export interface MonteCarloResult {
  trials: number;
  sigma: number;
  homeWinProb: number;
  awayWinProb: number;
  homeCoverProb?: number;
  awayCoverProb?: number;
  overProb?: number;
  underProb?: number;
  medianHomeScore: number;
  medianAwayScore: number;
}

export function runMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const trials = input.trials ?? TRIALS;
  const rand = mulberry32(hashSeed(input.gameId));
  const effectiveSigma = input.sigma * windSigmaScale(input.windMph);

  // Home covers a -X.X spread when its margin beats X.X; internal convention
  // is positive-margin-favors-home, same flip ensemble.ts already applies.
  const marketHomeMargin = input.marketHomeSpread != null ? -input.marketHomeSpread : undefined;

  let homeWins = 0;
  let homeCovers = 0;
  let awayCovers = 0;
  let overs = 0;
  let unders = 0;
  const homeScores: number[] = [];
  const awayScores: number[] = [];

  for (let i = 0; i < trials; i++) {
    const homeScore = Math.max(0, Math.round(input.homeMean + randomNormal(rand) * effectiveSigma));
    const awayScore = Math.max(0, Math.round(input.awayMean + randomNormal(rand) * effectiveSigma));
    const margin = homeScore - awayScore;
    const total = homeScore + awayScore;

    if (margin > 0) homeWins++;
    else if (margin < 0) {
      /* away win, counted via homeWins complement below */
    } else {
      homeWins += 0.5; // exact-tie trial (CFB has no regulation ties, but a discrete sim can land here) — split it
    }

    if (marketHomeMargin != null) {
      if (margin > marketHomeMargin) homeCovers++;
      else if (margin < marketHomeMargin) awayCovers++;
    }
    if (input.marketTotal != null) {
      if (total > input.marketTotal) overs++;
      else if (total < input.marketTotal) unders++;
    }

    homeScores.push(homeScore);
    awayScores.push(awayScore);
  }

  homeScores.sort((a, b) => a - b);
  awayScores.sort((a, b) => a - b);
  const median = (sorted: number[]) => sorted[Math.floor(sorted.length / 2)];

  return {
    trials,
    sigma: effectiveSigma,
    homeWinProb: homeWins / trials,
    awayWinProb: 1 - homeWins / trials,
    homeCoverProb: marketHomeMargin != null ? homeCovers / trials : undefined,
    awayCoverProb: marketHomeMargin != null ? awayCovers / trials : undefined,
    overProb: input.marketTotal != null ? overs / trials : undefined,
    underProb: input.marketTotal != null ? unders / trials : undefined,
    medianHomeScore: median(homeScores),
    medianAwayScore: median(awayScores),
  };
}
