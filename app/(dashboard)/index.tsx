import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import GameCard from '../../components/GameCard';
import WeekSelector from '../../components/WeekSelector';
import { db } from '../../lib/db';
import type { GameView } from '../../lib/types';

const CURRENT_SEASON = Number(process.env.EXPO_PUBLIC_CFB_SEASON ?? new Date().getFullYear());

export default function DashboardScreen() {
  const [selectedWeek, setSelectedWeek] = useState<number | undefined>(undefined);

  const { isLoading, error, data } = db.useQuery({
    games: {
      $: {
        where: { season: CURRENT_SEASON },
        order: { startDate: 'asc' },
      },
      homeTeam: {},
      awayTeam: {},
      venue: {},
      ensemblePicks: {},
      weatherForecasts: {},
    },
  });

  const games: GameView[] = useMemo(() => {
    if (!data?.games) return [];
    return data.games.map((g: any): GameView => ({
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
      pick: g.ensemblePicks?.[0]
        ? {
            atsPick: g.ensemblePicks[0].atsPick,
            atsConfidence: g.ensemblePicks[0].atsConfidence,
            totalPick: g.ensemblePicks[0].totalPick,
            totalConfidence: g.ensemblePicks[0].totalConfidence,
            mlPick: g.ensemblePicks[0].mlPick,
            mlEdge: g.ensemblePicks[0].mlEdge,
            marketHomeSpread: g.ensemblePicks[0].marketHomeSpread,
            marketTotal: g.ensemblePicks[0].marketTotal,
            predictedTotal: g.ensemblePicks[0].predictedTotal,
            adjustmentNotes: g.ensemblePicks[0].adjustmentNotes,
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
    }));
  }, [data]);

  const weeks = useMemo(() => {
    const set = new Set<number>();
    games.forEach((g) => set.add(g.week));
    return Array.from(set).sort((a, b) => a - b);
  }, [games]);

  const effectiveWeek = selectedWeek ?? weeks[0];
  const visibleGames = useMemo(
    () => games.filter((g) => g.week === effectiveWeek),
    [games, effectiveWeek],
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <WeekSelector weeks={weeks} selectedWeek={effectiveWeek} onSelect={setSelectedWeek} />

      {isLoading ? (
        <ActivityIndicator style={styles.centerFill} size="large" />
      ) : error ? (
        <View style={styles.centerFill}>
          <Text style={styles.errorText}>Couldn't load games: {error.message}</Text>
        </View>
      ) : visibleGames.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>
            No games loaded yet. Run the daily ETL job (see scripts/etl) to populate InstantDB.
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleGames}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <GameCard game={item} />}
          contentContainerStyle={styles.listContent}
        />
      )}

      <Link href="/settings" style={styles.settingsLink}>
        <Text style={styles.settingsLinkText}>Data freshness & settings</Text>
      </Link>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f6f8fa',
  },
  listContent: {
    paddingVertical: 8,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    color: '#cf222e',
    textAlign: 'center',
  },
  emptyText: {
    color: '#57606a',
    textAlign: 'center',
  },
  settingsLink: {
    padding: 12,
    alignItems: 'center',
  },
  settingsLinkText: {
    color: '#0969da',
    fontSize: 13,
  },
});
