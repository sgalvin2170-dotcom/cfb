import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import GameCard from '../../components/GameCard';
import WeekSelector from '../../components/WeekSelector';
import { formatDateHeader } from '../../lib/format';
import { useSeasonGames } from '../../lib/useSeasonGames';
import type { GameView } from '../../lib/types';

interface DateColumn {
  key: string;
  games: GameView[];
}

// Games are already ordered by startDate asc (see useSeasonGames), so each
// column's games stay in kickoff order for free.
function groupByCalendarDay(games: GameView[]): DateColumn[] {
  const map = new Map<string, GameView[]>();
  for (const game of games) {
    const d = new Date(game.startDate);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(game);
  }
  return Array.from(map.entries()).map(([key, games]) => ({ key, games }));
}

export default function DashboardScreen() {
  const [selectedWeek, setSelectedWeek] = useState<number | undefined>(undefined);
  const { isLoading, error, games, weeks } = useSeasonGames();

  const effectiveWeek = selectedWeek ?? weeks[0];
  const visibleGames = useMemo(
    () => games.filter((g) => g.week === effectiveWeek),
    [games, effectiveWeek],
  );
  const columns = useMemo(() => groupByCalendarDay(visibleGames), [visibleGames]);

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
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.board}>
          {columns.map((column) => (
            <View key={column.key} style={styles.column}>
              <View style={styles.dateHeader}>
                <View style={styles.dateDot} />
                <Text style={styles.dateHeaderText}>{formatDateHeader(column.games[0].startDate)}</Text>
              </View>
              <ScrollView contentContainerStyle={styles.columnList}>
                {column.games.map((game) => (
                  <GameCard key={game.id} game={game} />
                ))}
              </ScrollView>
            </View>
          ))}
        </ScrollView>
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
  board: {
    paddingHorizontal: 6,
    paddingTop: 8,
  },
  column: {
    width: 260,
    marginHorizontal: 4,
  },
  columnList: {
    paddingBottom: 8,
  },
  dateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0b1d3a',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginHorizontal: 6,
    marginBottom: 4,
  },
  dateDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#58a6ff',
  },
  dateHeaderText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
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
