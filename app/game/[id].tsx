import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import TeamBadge from '../../components/TeamBadge';
import { formatKickoff, formatSpread } from '../../lib/format';
import { db } from '../../lib/db';

const CURRENT_SEASON = Number(process.env.EXPO_PUBLIC_CFB_SEASON ?? new Date().getFullYear());

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { isLoading, error, data } = db.useQuery(
    id
      ? {
          games: {
            $: { where: { id } },
            homeTeam: {
              ratings: {},
              talent: {},
              recruitingClasses: { $: { where: { season: CURRENT_SEASON } } },
              rosterContinuity: { $: { where: { season: CURRENT_SEASON } } },
              portalIn: { $: { where: { season: CURRENT_SEASON } } },
              portalOut: { $: { where: { season: CURRENT_SEASON } } },
            },
            awayTeam: {
              ratings: {},
              talent: {},
              recruitingClasses: { $: { where: { season: CURRENT_SEASON } } },
              rosterContinuity: { $: { where: { season: CURRENT_SEASON } } },
              portalIn: { $: { where: { season: CURRENT_SEASON } } },
              portalOut: { $: { where: { season: CURRENT_SEASON } } },
            },
            venue: {},
            ensemblePicks: { $: { order: { computedAt: 'desc' } } },
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
          {game.venue.grass === true ? ' · Grass' : game.venue.grass === false ? ' · Turf' : ''}
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
        <Text style={styles.sectionTitle}>Recruiting and Portal Transfers</Text>
        <RecruitingPortalTeam label={game.awayTeam?.school ?? 'Away'} team={game.awayTeam} />
        <RecruitingPortalTeam label={game.homeTeam?.school ?? 'Home'} team={game.homeTeam} />
      </View>

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

function positionBreakdown(entries: any[]): string {
  if (entries.length === 0) return '—';
  const counts = new Map<string, number>();
  for (const e of entries) {
    const pos = e.position ?? '?';
    counts.set(pos, (counts.get(pos) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([pos, count]) => `${count} ${pos}`)
    .join(', ');
}

function RecruitingPortalTeam({ label, team }: { label: string; team: any }) {
  const recruiting = team?.recruitingClasses?.[0];
  const continuity = team?.rosterContinuity?.[0];
  const portalIn: any[] = team?.portalIn ?? [];
  const portalOut: any[] = team?.portalOut ?? [];
  const notable = [
    ...portalIn.filter((p) => p.topPortalPlayer).map((p) => ({ ...p, direction: 'in' as const })),
    ...portalOut.filter((p) => p.topPortalPlayer).map((p) => ({ ...p, direction: 'out' as const })),
  ];

  return (
    <View style={styles.teamBlock}>
      <Text style={styles.teamBlockTitle}>{label}</Text>
      <Row
        label="Recruiting class"
        value={recruiting ? `#${recruiting.rank ?? '—'} nationally (${recruiting.points?.toFixed(1) ?? '—'} pts)` : 'Not yet ranked'}
      />
      {recruiting ? (
        <Row label="5-star / 4-star signees" value={`${recruiting.fiveStars} / ${recruiting.fourStars}`} />
      ) : null}
      <Row
        label="Returning players (off / def)"
        value={continuity ? `${continuity.offenseReturning} / ${continuity.defenseReturning}` : 'Not yet published'}
      />
      <Row label="Portal — incoming" value={`${portalIn.length} (${positionBreakdown(portalIn)})`} />
      <Row label="Portal — outgoing" value={`${portalOut.length} (${positionBreakdown(portalOut)})`} />
      {notable.length > 0 ? (
        <View style={styles.notableList}>
          <Text style={styles.notableTitle}>Top-100 portal players</Text>
          {notable.map((p) => (
            <Text key={p.id} style={styles.notableItem}>
              <Text style={p.direction === 'in' ? styles.arrowIn : styles.arrowOut}>
                {p.direction === 'in' ? '↑' : '↓'}
              </Text>
              {' '}{p.firstName} {p.lastName} ({p.position ?? '?'})
              {p.direction === 'in' ? ` from ${p.originName ?? 'the portal'}` : ` to ${p.destinationName ?? 'the portal'}`}
              {p.portalRank ? ` — #${p.portalRank} in portal` : ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
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
  teamBlock: {
    marginTop: 6,
  },
  teamBlockTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#57606a',
    marginBottom: 2,
  },
  notableList: {
    marginTop: 6,
    marginBottom: 4,
    gap: 2,
  },
  notableTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0b1d3a',
  },
  notableItem: {
    fontSize: 12,
    color: '#57606a',
  },
  arrowIn: {
    color: '#1a7f37',
    fontWeight: '700',
  },
  arrowOut: {
    color: '#cf222e',
    fontWeight: '700',
  },
});
