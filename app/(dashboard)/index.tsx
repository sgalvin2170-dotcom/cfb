import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import GameCard from '../../components/GameCard';
import WeekSelector from '../../components/WeekSelector';
import { useSeasonGames } from '../../lib/useSeasonGames';

export default function DashboardScreen() {
  const [selectedWeek, setSelectedWeek] = useState<number | undefined>(undefined);
  const { isLoading, error, games, weeks } = useSeasonGames();

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
