// v1 ensemble: equal-weight blend of whichever core rating sources have data
// for a given team/season, converted to a common "predicted home margin"
// scale, compared against the market spread for an ATS pick. Totals and
// moneyline picks aren't computed yet — those need FEI (for totals) and a
// devigged win-probability model, which come in a later phase.
import { id, lookup } from '@instantdb/admin';

import { db, transactInChunks } from './instantAdmin';
import { recordRun } from './upsertCore';
import { env } from './env';

const MODEL_VERSION = 'v1-equal-weight';

// ESPN doesn't return its home-field-advantage constant from the API — this
// is their own documented long-run average, not something we scraped live.
const ESPN_HFA = 2.15;

async function fetchSagarinPredictorHfa(): Promise<number | undefined> {
  try {
    const { fetchSagarinRatings } = await import('./sources/sagarin');
    const data = await fetchSagarinRatings();
    if (data.season !== env.season) return undefined; // stale off-season page, don't use its HFA either
    return data.homeAdvantage.predictor;
  } catch (err) {
    console.warn('[ensemble] could not refresh Sagarin home-advantage constant:', err);
    return undefined;
  }
}

function confidenceTier(absEdge: number): string {
  if (absEdge >= 3) return 'high';
  if (absEdge >= 1) return 'medium';
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
  const sagarinHfa = await fetchSagarinPredictorHfa();

  const { games } = await db.query({
    games: {
      $: { where: week != null ? { season: env.season, week } : { season: env.season } },
      homeTeam: { ratings: {} },
      awayTeam: { ratings: {} },
      odds: {},
    },
  });

  const now = new Date().toISOString();
  let computed = 0;
  let skippedNoSources = 0;

  const txs = (games as any[]).flatMap((game) => {
    const contributions: Array<{ source: string; margin: number }> = [];

    const homeFpi = latestMetrics(game.homeTeam?.ratings ?? [], 'espn_fpi', env.season);
    const awayFpi = latestMetrics(game.awayTeam?.ratings ?? [], 'espn_fpi', env.season);
    if (homeFpi.has('fpi') && awayFpi.has('fpi')) {
      contributions.push({
        source: 'espn_fpi',
        margin: homeFpi.get('fpi')! - awayFpi.get('fpi')! + ESPN_HFA,
      });
    }

    if (sagarinHfa != null) {
      const homeSagarin = latestMetrics(game.homeTeam?.ratings ?? [], 'sagarin', env.season);
      const awaySagarin = latestMetrics(game.awayTeam?.ratings ?? [], 'sagarin', env.season);
      if (homeSagarin.has('sagarin_predictor') && awaySagarin.has('sagarin_predictor')) {
        contributions.push({
          source: 'sagarin_predictor',
          margin: homeSagarin.get('sagarin_predictor')! - awaySagarin.get('sagarin_predictor')! + sagarinHfa,
        });
      }
    }

    if (contributions.length === 0) {
      skippedNoSources++;
      return [];
    }

    const predictedMargin =
      contributions.reduce((sum, c) => sum + c.margin, 0) / contributions.length;

    const odds = game.odds?.[0];
    // Flip CFBD's convention (negative = home favored) to ours (positive =
    // home favored) so the two are directly comparable.
    const marketHomeMargin = odds?.homeSpread != null ? -odds.homeSpread : undefined;

    let atsPick: string | undefined;
    let atsConfidence: string | undefined;
    if (marketHomeMargin != null) {
      const edge = predictedMargin - marketHomeMargin;
      atsPick = edge > 0 ? 'home' : 'away';
      atsConfidence = confidenceTier(Math.abs(edge));
    }

    computed++;
    return [
      db.tx.ensemble_picks.lookup('pickKey', `${MODEL_VERSION}:${game.cfbdGameId}`)
        .update({
          modelVersion: MODEL_VERSION,
          rawPredictedMargin: predictedMargin,
          adjustedPredictedMargin: predictedMargin,
          marketHomeSpread: odds?.homeSpread,
          marketTotal: odds?.overUnder,
          atsPick,
          atsConfidence,
          adjustmentNotes: `blend of ${contributions.length} source(s): ${contributions
            .map((c) => c.source)
            .join(', ')}`,
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
