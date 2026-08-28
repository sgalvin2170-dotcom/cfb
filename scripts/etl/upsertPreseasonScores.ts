// Preseason roster-composition ETL step -> InstantDB `preseason_scores`.
// Needs teams, talent, recruiting_classes, roster_continuity, and
// portal_transfers already upserted (runs after runRecruitingPortalIngestion
// in index.ts).
//
// Formula (a documented methodology, not independently backtested by this
// project — treat it the same as the moneyline sigma placeholder elsewhere:
// a reasonable, sourced starting point, not a validated model):
//   rosterScore = returningProduction*0.70 + transferPortal*0.15 + recruiting*0.15
// matching the widely-cited "returning production is the dominant early-
// season signal" framing (e.g. SP+-style preseason baselines). CFBD's talent
// composite is shown alongside as context but isn't a formula input — the
// user-provided spec listed it as a separate display field, not a fourth
// weighted component.
//
// Every input's raw scale is arbitrary and non-comparable (roster_continuity
// is a whole-roster overlap count, not literally "returning starters" — see
// upsertRecruitingPortal.ts; incoming-transfer rating is CFBD's own
// portal-rating scale; 247Sports points and CFBD's talent composite are
// their own ranking scales), so each is converted to a league-wide
// percentile (0-100) before blending, rather than combined on whatever
// scale each metric happens to already have.
import { db, transactInChunks } from './instantAdmin';
import { recordRun } from './upsertCore';
import { env } from './env';

interface TeamRow {
  id: string;
  talentScore?: number;
  recruitingPoints?: number;
  returningTotal?: number;
  portalIncomingRating?: number;
}

// Percentile rank within the population that actually has this metric — a
// team missing an input just doesn't get a percentile for it (and is
// excluded from that component's blend contribution) rather than being
// penalized with a fabricated 0, same "missing != worst" resilience as the
// ensemble's own margin blend.
function percentileRank(value: number, all: number[]): number {
  if (all.length <= 1) return 50;
  const sorted = [...all].sort((a, b) => a - b);
  const countBelowOrEqual = sorted.filter((v) => v <= value).length;
  return (countBelowOrEqual / sorted.length) * 100;
}

async function upsertPreseasonScores() {
  const { teams } = await db.query({
    teams: {
      talent: { $: { where: { season: env.season } } },
      recruitingClasses: { $: { where: { season: env.season } } },
      rosterContinuity: { $: { where: { season: env.season } } },
      portalIn: { $: { where: { season: env.season } } },
    },
  });

  const rows: TeamRow[] = (teams as any[]).map((t) => {
    const continuity = t.rosterContinuity?.[0];
    const portalRating = (t.portalIn ?? []).reduce((sum: number, p: any) => sum + (p.rating ?? 0), 0);
    return {
      id: t.id,
      talentScore: t.talent?.[0]?.talentScore,
      recruitingPoints: t.recruitingClasses?.[0]?.points,
      returningTotal: continuity ? continuity.offenseReturning + continuity.defenseReturning : undefined,
      portalIncomingRating: t.portalIn && t.portalIn.length > 0 ? portalRating : undefined,
    };
  });

  const talentPool = rows.map((r) => r.talentScore).filter((v): v is number => v != null);
  const recruitingPool = rows.map((r) => r.recruitingPoints).filter((v): v is number => v != null);
  const returningPool = rows.map((r) => r.returningTotal).filter((v): v is number => v != null);
  const portalPool = rows.map((r) => r.portalIncomingRating).filter((v): v is number => v != null);

  const now = new Date().toISOString();
  const txs = rows.flatMap((row) => {
    const talentPercentile = row.talentScore != null ? percentileRank(row.talentScore, talentPool) : undefined;
    const recruitingScore = row.recruitingPoints != null ? percentileRank(row.recruitingPoints, recruitingPool) : undefined;
    const returningProductionScore =
      row.returningTotal != null ? percentileRank(row.returningTotal, returningPool) : undefined;
    const transferPortalScore =
      row.portalIncomingRating != null ? percentileRank(row.portalIncomingRating, portalPool) : undefined;

    // Blend only over whichever of the three formula inputs this team
    // actually has, renormalizing weights among those — same "tolerate a
    // missing source" pattern the ensemble margin blend already uses.
    const parts: { score: number; weight: number }[] = [];
    if (returningProductionScore != null) parts.push({ score: returningProductionScore, weight: 0.7 });
    if (transferPortalScore != null) parts.push({ score: transferPortalScore, weight: 0.15 });
    if (recruitingScore != null) parts.push({ score: recruitingScore, weight: 0.15 });
    if (parts.length === 0) return [];

    const weightTotal = parts.reduce((s, p) => s + p.weight, 0);
    const rosterScore = parts.reduce((s, p) => s + p.score * p.weight, 0) / weightTotal;

    return [
      db.tx.preseason_scores
        .lookup('scoreKey', `${row.id}:${env.season}`)
        .update({
          season: env.season,
          talentPercentile: talentPercentile ?? 0,
          returningProductionScore: returningProductionScore ?? 0,
          transferPortalScore: transferPortalScore ?? 0,
          recruitingScore: recruitingScore ?? 0,
          rosterScore,
          computedAt: now,
        })
        .link({ team: row.id }),
    ];
  });

  await transactInChunks(txs);
  return txs.length;
}

export async function runPreseasonScoresIngestion() {
  return recordRun('preseason-scores', upsertPreseasonScores);
}
