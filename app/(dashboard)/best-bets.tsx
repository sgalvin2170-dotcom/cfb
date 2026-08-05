import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import WeekSelector from '../../components/WeekSelector';
import { confidenceColor, formatKickoff, formatSpread } from '../../lib/format';
import { useSeasonGames } from '../../lib/useSeasonGames';
import type { GameView } from '../../lib/types';

// Mirrors the confidence-tier point/probability thresholds in
// scripts/etl/ensemble.ts. Dividing each bet's edge by its own market's
// "high confidence" cutoff puts point-based (ATS/Total) and probability-based
// (ML) edges on one comparable 0-and-up scale for ranking across markets.
const ATS_HIGH_PTS = 3;
const TOTAL_HIGH_PTS = 6;
const ML_HIGH_EDGE = 0.1;

interface BestBet {
  key: string;
  game: GameView;
  market: 'ATS' | 'Total' | 'ML';
  pickLabel: string;
  confidence?: string;
  strength: number;
  edgeText: string;
  reason: string;
}

function matchupLabel(game: GameView): string {
  const away = game.awayTeam?.school ?? 'Away';
  const home = game.homeTeam?.school ?? 'Home';
  return `${away} @ ${home}`;
}

function buildBets(games: GameView[]): BestBet[] {
  const bets: BestBet[] = [];

  for (const game of games) {
    const pick = game.pick;
    if (!pick) continue;
    const matchup = matchupLabel(game);

    if (pick.atsPick && pick.marketHomeSpread != null && pick.adjustedPredictedMargin != null) {
      const edge = pick.adjustedPredictedMargin + pick.marketHomeSpread;
      const team = pick.atsPick === 'home' ? game.homeTeam : game.awayTeam;
      const line = pick.atsPick === 'home' ? pick.marketHomeSpread : -pick.marketHomeSpread;
      bets.push({
        key: `${game.id}-ats`,
        game,
        market: 'ATS',
        pickLabel: `${team?.school ?? pick.atsPick.toUpperCase()} ${formatSpread(line)}`,
        confidence: pick.atsConfidence,
        strength: Math.abs(edge) / ATS_HIGH_PTS,
        edgeText: `${Math.abs(edge).toFixed(1)} pt edge`,
        reason: `${matchup}: model margin ${formatSpread(pick.adjustedPredictedMargin)} (home) vs market ${formatSpread(
          pick.marketHomeSpread,
        )}. ${pick.adjustmentNotes ?? ''}`.trim(),
      });
    }

    if (pick.totalPick && pick.marketTotal != null && pick.predictedTotal != null) {
      const edge = pick.predictedTotal - pick.marketTotal;
      bets.push({
        key: `${game.id}-total`,
        game,
        market: 'Total',
        pickLabel: `${pick.totalPick === 'over' ? 'Over' : 'Under'} ${pick.marketTotal.toFixed(1)}`,
        confidence: pick.totalConfidence,
        strength: Math.abs(edge) / TOTAL_HIGH_PTS,
        edgeText: `${Math.abs(edge).toFixed(1)} pt edge`,
        reason: `${matchup}: model total ${pick.predictedTotal.toFixed(1)} vs market ${pick.marketTotal.toFixed(1)}. ${
          pick.adjustmentNotes ?? ''
        }`.trim(),
      });
    }

    if (pick.mlPick && pick.mlEdge != null) {
      const team = pick.mlPick === 'home' ? game.homeTeam : game.awayTeam;
      const edgePct = Math.abs(pick.mlEdge) * 100;
      bets.push({
        key: `${game.id}-ml`,
        game,
        market: 'ML',
        pickLabel: `${team?.school ?? pick.mlPick.toUpperCase()} ML`,
        confidence: Math.abs(pick.mlEdge) >= ML_HIGH_EDGE ? 'high' : 'medium',
        strength: Math.abs(pick.mlEdge) / ML_HIGH_EDGE,
        edgeText: `${edgePct.toFixed(1)}% win-prob edge`,
        reason: `${matchup}: model gives ${team?.school ?? pick.mlPick} a ${edgePct.toFixed(
          1,
        )}pt edge over the market's devigged win probability.`,
      });
    }
  }

  return bets.sort((a, b) => b.strength - a.strength);
}

export default function BestBetsScreen() {
  const { isLoading, error, games, weeks } = useSeasonGames();
  const [selectedWeek, setSelectedWeek] = useState<number | undefined>(undefined);
  const effectiveWeek = selectedWeek ?? weeks[0];

  const topBets = useMemo(() => {
    const weekGames = games.filter((g) => g.week === effectiveWeek);
    return buildBets(weekGames).slice(0, 10);
  }, [games, effectiveWeek]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <WeekSelector weeks={weeks} selectedWeek={effectiveWeek} onSelect={setSelectedWeek} />

      {isLoading ? (
        <ActivityIndicator style={styles.centerFill} size="large" />
      ) : error ? (
        <View style={styles.centerFill}>
          <Text style={styles.errorText}>Couldn't load games: {error.message}</Text>
        </View>
      ) : topBets.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>No graded picks yet for this week.</Text>
        </View>
      ) : (
        <FlatList
          data={topBets}
          keyExtractor={(item) => item.key}
          renderItem={({ item, index }) => <BestBetCard bet={item} rank={index + 1} />}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
}

function BestBetCard({ bet, rank }: { bet: BestBet; rank: number }) {
  return (
    <Link href={{ pathname: '/game/[id]', params: { id: bet.game.id } }} asChild>
      <Pressable style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.rank}>#{rank}</Text>
          <Text style={styles.marketTag}>{bet.market}</Text>
          <Text style={styles.kickoff}>{formatKickoff(bet.game.startDate)}</Text>
        </View>
        <Text style={styles.pickLabel}>{bet.pickLabel}</Text>
        <Text style={[styles.confidenceLine, { color: confidenceColor(bet.confidence) }]}>
          {bet.confidence?.toUpperCase() ?? '—'} confidence · {bet.edgeText}
        </Text>
        <Text style={styles.reason}>{bet.reason}</Text>
      </Pressable>
    </Link>
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
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  rank: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0b1d3a',
  },
  marketTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0969da',
    backgroundColor: '#ddf4ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  kickoff: {
    fontSize: 12,
    color: '#57606a',
    marginLeft: 'auto',
  },
  pickLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0b1d3a',
  },
  confidenceLine: {
    fontSize: 12,
    fontWeight: '700',
  },
  reason: {
    fontSize: 12,
    color: '#57606a',
    marginTop: 4,
    lineHeight: 17,
  },
});
