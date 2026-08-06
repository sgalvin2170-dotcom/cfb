import { Image, StyleSheet, Text, View } from 'react-native';

import type { TeamView } from '../lib/types';

export default function TeamBadge({ team, rank }: { team?: TeamView; rank?: number }) {
  return (
    <View style={styles.row}>
      {team?.logoUrl ? (
        <Image source={{ uri: team.logoUrl }} style={styles.logo} resizeMode="contain" />
      ) : (
        <View style={styles.logoFallback} />
      )}
      {rank != null ? <Text style={styles.rankBadge}>#{rank}</Text> : null}
      <Text style={styles.name} numberOfLines={1}>
        {team?.school ?? 'TBD'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  logo: {
    width: 24,
    height: 24,
  },
  logoFallback: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#d0d7de',
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0b1d3a',
    flexShrink: 1,
  },
  rankBadge: {
    fontSize: 12,
    fontWeight: '800',
    color: '#9a6700',
  },
});
