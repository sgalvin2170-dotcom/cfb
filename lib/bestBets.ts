// Shared ATS/Total/ML "best bet" edge/strength formulas and ranking. Used by
// both the Best Bets screen (live, current-data ranking) and the ensemble
// ETL (frozen, as-of-kickoff ranking stored on ensemble_picks for Post-Game
// Analysis) so the two can never silently diverge on what counts as a
// top-10 bet.
//
// Dividing each bet's edge by its own market's "high confidence" cutoff
// (mirrored from scripts/etl/ensemble.ts's confidence tiers) puts
// point-based (ATS/Total) and probability-based (ML) edges on one
// comparable 0-and-up scale for ranking across markets.
export const ATS_HIGH_PTS = 3;
export const TOTAL_HIGH_PTS = 6;
export const ML_HIGH_EDGE = 0.1;

export function atsEdge(adjustedPredictedMargin: number, marketHomeSpread: number): number {
  return adjustedPredictedMargin + marketHomeSpread;
}

export function totalEdge(predictedTotal: number, marketTotal: number): number {
  return predictedTotal - marketTotal;
}

export function atsStrength(edge: number): number {
  return Math.abs(edge) / ATS_HIGH_PTS;
}

export function totalStrength(edge: number): number {
  return Math.abs(edge) / TOTAL_HIGH_PTS;
}

export function mlStrength(mlEdge: number): number {
  return Math.abs(mlEdge) / ML_HIGH_EDGE;
}

export type BestBetMarket = 'ATS' | 'Total' | 'ML';

export interface BestBetPickInput {
  gameId: string;
  atsPick?: string | null;
  marketHomeSpread?: number | null;
  adjustedPredictedMargin?: number | null;
  totalPick?: string | null;
  marketTotal?: number | null;
  predictedTotal?: number | null;
  mlPick?: string | null;
  mlEdge?: number | null;
}

interface BestBetCandidate {
  gameId: string;
  market: BestBetMarket;
  strength: number;
}

function buildBestBetCandidates(picks: BestBetPickInput[]): BestBetCandidate[] {
  const candidates: BestBetCandidate[] = [];
  for (const pick of picks) {
    if (pick.atsPick && pick.marketHomeSpread != null && pick.adjustedPredictedMargin != null) {
      candidates.push({
        gameId: pick.gameId,
        market: 'ATS',
        strength: atsStrength(atsEdge(pick.adjustedPredictedMargin, pick.marketHomeSpread)),
      });
    }
    if (pick.totalPick && pick.marketTotal != null && pick.predictedTotal != null) {
      candidates.push({
        gameId: pick.gameId,
        market: 'Total',
        strength: totalStrength(totalEdge(pick.predictedTotal, pick.marketTotal)),
      });
    }
    if (pick.mlPick && pick.mlEdge != null) {
      candidates.push({ gameId: pick.gameId, market: 'ML', strength: mlStrength(pick.mlEdge) });
    }
  }
  return candidates.sort((a, b) => b.strength - a.strength);
}

// "{gameId}:{market}" -> 1-based rank, for whichever candidates land in the
// top N. Ranking is meant to be computed per-week (matching the Best Bets
// screen's per-week top-10 scope) — callers should pass only one week's
// picks per call.
export function rankBestBets(picks: BestBetPickInput[], topN = 10): Map<string, number> {
  const ranks = new Map<string, number>();
  buildBestBetCandidates(picks)
    .slice(0, topN)
    .forEach((c, i) => ranks.set(`${c.gameId}:${c.market}`, i + 1));
  return ranks;
}
