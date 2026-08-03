import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { db } from '../lib/db';

export default function SettingsScreen() {
  const { isLoading, error, data } = db.useQuery({
    scrape_runs: {
      $: { order: { finishedAt: 'desc' } },
    },
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Data Freshness</Text>
      <Text style={styles.dim}>
        Last completed run per source. If a source shows as stale or errored, the ensemble should
        still be usable — it re-weights over whichever sources are available for the day.
      </Text>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 16 }} />
      ) : error ? (
        <Text style={styles.errorText}>Couldn't load scrape history: {error.message}</Text>
      ) : (
        latestBySource(data?.scrape_runs ?? []).map((run) => (
          <View key={run.source} style={styles.row}>
            <Text style={styles.rowLabel}>{run.source}</Text>
            <Text style={[styles.rowValue, run.status === 'error' && styles.rowValueError]}>
              {run.status} · {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : 'never'}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function latestBySource(runs: any[]) {
  const bySource = new Map<string, any>();
  for (const run of runs) {
    if (!bySource.has(run.source)) bySource.set(run.source, run);
  }
  return Array.from(bySource.values());
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0b1d3a',
  },
  dim: {
    fontSize: 13,
    color: '#8b949e',
    marginBottom: 8,
  },
  errorText: {
    color: '#cf222e',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d7de',
  },
  rowLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0b1d3a',
  },
  rowValue: {
    fontSize: 13,
    color: '#57606a',
  },
  rowValueError: {
    color: '#cf222e',
    fontWeight: '700',
  },
});
