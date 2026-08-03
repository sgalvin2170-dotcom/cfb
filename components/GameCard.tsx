import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { confidenceColor, formatKickoff, formatSpread } from '../lib/format';
import type { GameView } from '../lib/types';
import TeamBadge from './TeamBadge';

export default function GameCard({ game }: { game: GameView }) {
  const pick = game.pick;

  return (
    <Link href={{ pathname: '/game/[id]', params: { id: game.id } }} asChild>
      <Pressable style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.kickoff}>{formatKickoff(game.startDate)}</Text>
          {game.venue?.dome ? <Text style={styles.domeTag}>DOME</Text> : null}
        </View>

        <TeamBadge team={game.awayTeam} />
        <Text style={styles.at}>@</Text>
        <TeamBadge team={game.homeTeam} />

        {game.venue ? (
          <Text style={styles.venue} numberOfLines={1}>
            {game.venue.name}
            {game.venue.capacity ? ` · Cap. ${game.venue.capacity.toLocaleString()}` : ''}
          </Text>
        ) : null}

        {pick ? (
          <View style={styles.picksRow}>
            <PickPill label="ATS" value={pick.atsPick} confidence={pick.atsConfidence} sub={formatSpread(pick.marketHomeSpread)} />
            <PickPill label="O/U" value={pick.totalPick} confidence={pick.totalConfidence} sub={pick.marketTotal?.toFixed(1)} />
            <PickPill label="ML" value={pick.mlPick} confidence={pick.mlEdge && pick.mlEdge > 0.05 ? 'high' : 'medium'} />
          </View>
        ) : (
          <Text style={styles.noPick}>No pick yet — awaiting data</Text>
        )}
      </Pressable>
    </Link>
  );
}

function PickPill({
  label,
  value,
  confidence,
  sub,
}: {
  label: string;
  value?: string;
  confidence?: string;
  sub?: string;
}) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillLabel}>{label}</Text>
      <Text style={[styles.pillValue, { color: confidenceColor(confidence) }]} numberOfLines={1}>
        {value ?? '—'}
      </Text>
      {sub ? <Text style={styles.pillSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    gap: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  kickoff: {
    fontSize: 12,
    fontWeight: '600',
    color: '#57606a',
  },
  domeTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0969da',
    backgroundColor: '#ddf4ff',
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  at: {
    fontSize: 12,
    color: '#8b949e',
    marginLeft: 32,
  },
  venue: {
    fontSize: 12,
    color: '#8b949e',
    marginTop: 4,
  },
  picksRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  pill: {
    flex: 1,
    backgroundColor: '#f6f8fa',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  pillLabel: {
    fontSize: 10,
    color: '#8b949e',
    fontWeight: '700',
  },
  pillValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  pillSub: {
    fontSize: 10,
    color: '#8b949e',
  },
  noPick: {
    fontSize: 12,
    color: '#8b949e',
    fontStyle: 'italic',
    marginTop: 8,
  },
});
