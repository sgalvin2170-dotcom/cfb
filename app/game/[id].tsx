import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import TeamBadge from '../../components/TeamBadge';
import { formatKickoff, formatSpread } from '../../lib/format';
import { db } from '../../lib/db';

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { isLoading, error, data } = db.useQuery(
    id
      ? {
          games: {
            $: { where: { id } },
            homeTeam: { ratings: {}, talent: {} },
            awayTeam: { ratings: {}, talent: {} },
            venue: {},
            ensemblePicks: {},
            weatherForecasts: {},
          },
        }
      : null,
  );

  if (isLoading) return <ActivityIndicator style={styles.centerFill} size="large" />;
  if (error) {
    return (
      <View style={styles.centerFill}>
        <Text style={styles.errorText}>Couldn't load game: {error.message}</Text>
      </View>
    );
  }

  const game = data?.games?.[0] as any;
  if (!game) {
    return (
      <View style={styles.centerFill}>
        <Text style={styles.errorText}>Game not found.</Text>
      </View>
    );
  }

  const pick = game.ensemblePicks?.[0];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.kickoff}>{formatKickoff(game.startDate)}</Text>

      <View style={styles.matchup}>
        <TeamBadge team={game.awayTeam} />
        <Text style={styles.at}>at</Text>
        <TeamBadge team={game.homeTeam} />
      </View>

      {game.venue ? (
        <Text style={styles.venue}>
          {game.venue.name}
          {game.venue.city ? ` · ${game.venue.city}, ${game.venue.state ?? ''}` : ''}
          {game.venue.capacity ? ` · Capacity ${game.venue.capacity.toLocaleString()}` : ''}
          {game.venue.dome ? ' · Dome' : ''}
        </Text>
      ) : null}

      {game.weatherForecasts?.[0] ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Weather at kickoff</Text>
          <Row label="Temperature" value={fmtOrDash(game.weatherForecasts[0].tempF, (v) => `${Math.round(v)}°F`)} />
          <Row
            label="Wind"
            value={fmtOrDash(
              game.weatherForecasts[0].windMph,
              (v) => `${Math.round(v)} mph${game.weatherForecasts[0].windDir ? ` ${game.weatherForecasts[0].windDir}` : ''}`,
            )}
          />
          <Row label="Precipitation chance" value={fmtOrDash(game.weatherForecasts[0].precipProb, (v) => `${Math.round(v)}%`)} />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Ensemble Picks</Text>
        {pick ? (
          <>
            <Row label="Spread (ATS)" value={`${pick.atsPick ?? '—'} (market ${formatSpread(pick.marketHomeSpread)})`} />
            <Row label="Total (O/U)" value={`${pick.totalPick ?? '—'} (market ${pick.marketTotal?.toFixed(1) ?? '—'}, model ${pick.predictedTotal?.toFixed(1) ?? '—'})`} />
            <Row label="Moneyline" value={pick.mlPick ?? '—'} />
            <Row label="Model margin (raw / adjusted)" value={`${formatSpread(pick.rawPredictedMargin)} / ${formatSpread(pick.adjustedPredictedMargin)}`} />
            {pick.adjustmentNotes ? <Row label="Adjustment notes" value={pick.adjustmentNotes} /> : null}
          </>
        ) : (
          <Text style={styles.dim}>No ensemble pick computed yet for this game.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Per-source ratings — {game.awayTeam?.school ?? 'Away'}</Text>
        {game.awayTeam?.talent?.[0] ? (
          <Row label="Talent composite" value={game.awayTeam.talent[0].talentScore?.toFixed(1)} />
        ) : null}
        <RatingsList ratings={game.awayTeam?.ratings} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Per-source ratings — {game.homeTeam?.school ?? 'Home'}</Text>
        {game.homeTeam?.talent?.[0] ? (
          <Row label="Talent composite" value={game.homeTeam.talent[0].talentScore?.toFixed(1)} />
        ) : null}
        <RatingsList ratings={game.homeTeam?.ratings} />
      </View>
    </ScrollView>
  );
}

function fmtOrDash(value: number | undefined, fmt: (v: number) => string): string | undefined {
  return value != null ? fmt(value) : undefined;
}

function RatingsList({ ratings }: { ratings?: any[] }) {
  if (!ratings || ratings.length === 0) {
    return <Text style={styles.dim}>No ratings ingested yet for this team.</Text>;
  }
  return (
    <>
      {ratings.map((r) => (
        <Row key={r.id} label={`${r.source} · ${r.metricName}`} value={r.value?.toFixed(2)} />
      ))}
    </>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value ?? '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 16,
    gap: 12,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#cf222e',
  },
  kickoff: {
    fontSize: 13,
    color: '#57606a',
    fontWeight: '600',
  },
  matchup: {
    gap: 6,
  },
  at: {
    fontSize: 12,
    color: '#8b949e',
    marginLeft: 32,
  },
  venue: {
    fontSize: 13,
    color: '#57606a',
  },
  section: {
    marginTop: 8,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0b1d3a',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d7de',
  },
  rowLabel: {
    fontSize: 13,
    color: '#57606a',
    flexShrink: 1,
  },
  rowValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0b1d3a',
  },
  dim: {
    fontSize: 13,
    color: '#8b949e',
    fontStyle: 'italic',
  },
});
