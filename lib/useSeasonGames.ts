// Shared query used by both the Slate and Best Bets tabs so the two screens
// can't drift out of sync on the ensemblePicks ordering fix (see
// app/(dashboard)/index.tsx history — stale v1 picks bug).
import { useMemo } from 'react';

import { db } from './db';
import type { GameView } from './types';

const CURRENT_SEASON = Number(process.env.EXPO_PUBLIC_CFB_SEASON ?? new Date().getFullYear());

export function useSeasonGames() {
  const { isLoading, error, data } = db.useQuery({
    games: {
      $: {
        where: { season: CURRENT_SEASON },
        order: { startDate: 'asc' },
      },
      homeTeam: {},
      awayTeam: {},
      venue: {},
      ensemblePicks: { $: { order: { computedAt: 'desc' } } },
      weatherForecasts: {},
    },
  });

  const games: GameView[] = useMemo(() => {
    if (!data?.games) return [];
    return data.games.map((g: any): GameView => {
      const pick = g.ensemblePicks?.[0];
      return {
        id: g.id,
        season: g.season,
        week: g.week,
        startDate: g.startDate,
        neutralSite: g.neutralSite,
        tv: g.tv,
        homeTeam: g.homeTeam
          ? {
              id: g.homeTeam.id,
              school: g.homeTeam.school,
              abbreviation: g.homeTeam.abbreviation,
              logoUrl: g.homeTeam.logoUrl,
            }
          : undefined,
        awayTeam: g.awayTeam
          ? {
              id: g.awayTeam.id,
              school: g.awayTeam.school,
              abbreviation: g.awayTeam.abbreviation,
              logoUrl: g.awayTeam.logoUrl,
            }
          : undefined,
        venue: g.venue
          ? {
              id: g.venue.id,
              name: g.venue.name,
              city: g.venue.city,
              state: g.venue.state,
              capacity: g.venue.capacity,
              dome: g.venue.dome,
            }
          : undefined,
        pick: pick
          ? {
              atsPick: pick.atsPick,
              atsConfidence: pick.atsConfidence,
              totalPick: pick.totalPick,
              totalConfidence: pick.totalConfidence,
              mlPick: pick.mlPick,
              mlEdge: pick.mlEdge,
              marketHomeSpread: pick.marketHomeSpread,
              marketTotal: pick.marketTotal,
              predictedTotal: pick.predictedTotal,
              adjustedPredictedMargin: pick.adjustedPredictedMargin,
              adjustmentNotes: pick.adjustmentNotes,
            }
          : undefined,
        weather: g.weatherForecasts?.[0]
          ? {
              tempF: g.weatherForecasts[0].tempF,
              windMph: g.weatherForecasts[0].windMph,
              windDir: g.weatherForecasts[0].windDir,
              precipProb: g.weatherForecasts[0].precipProb,
            }
          : undefined,
      };
    });
  }, [data]);

  const weeks = useMemo(() => {
    const set = new Set<number>();
    games.forEach((g) => set.add(g.week));
    return Array.from(set).sort((a, b) => a - b);
  }, [games]);

  return { isLoading, error, games, weeks };
}
