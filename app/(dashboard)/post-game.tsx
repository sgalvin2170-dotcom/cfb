import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import WeekSelector from '../../components/WeekSelector';
import { db } from '../../lib/db';
import { formatKickoff, formatSpread, formatTotal } from '../../lib/format';
import { gradeAts, gradeTotal, gradeColor, type Grade } from '../../lib/grading';
import { aggregateBoxScore, type BoxScoreAgg } from '../../lib/boxScoreAgg';

const CURRENT_SEASON = Number(process.env.EXPO_PUBLIC_CFB_SEASON ?? new Date().getFullYear());

export default function PostGameAnalysisScreen() {
  const [selectedWeek, setSelectedWeek] = useState<number | undefined>(undefined);

  const { isLoading, error, data } = db.useQuery({
    games: {
      $: { where: { season: CURRENT_SEASON, completed: true }, order: { startDate: 'desc' } },
      homeTeam: { gameStats: {} },
      awayTeam: { gameStats: {} },
      odds: {},
      ensemblePicks: { $: { order: { computedAt: 'desc' } } },
      teamStats: { team: {} },
      weatherForecasts: {},
    },
  });

  const games = (data?.games ?? []) as any[];
  const weeks = useMemo(() => Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b), [games]);
  const effectiveWeek = selectedWeek ?? weeks[weeks.length - 1];
  const visibleGames = useMemo(() => games.filter((g) => g.week === effectiveWeek), [games, effectiveWeek]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <WeekSelector weeks={weeks} selectedWeek={effectiveWeek} onSelect={setSelectedWeek} />

      {isLoading ? (
        <ActivityIndicator style={styles.centerFill} size="large" />
      ) : error ? (
        <View style={styles.centerFill}>
          <Text style={styles.errorText}>Couldn't load results: {error.message}</Text>
        </View>
      ) : weeks.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>No completed games yet this season.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {visibleGames.map((game) => (
            <PostGameCard key={game.id} game={game} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// Model margin is stored "positive = home favored" (see marginModel.ts);
// market/actual are shown in CFBD's own "negative = home favored" spread
// convention instead, specifically so all three numbers on this screen sit
// in one directly-comparable convention — unlike Game Detail, which shows
// the model margin in its native sign since it's not side-by-side with a
// market number there in the same way.
function PostGameCard({ game }: { game: any }) {
  const pick = game.ensemblePicks?.[0];
  const odds = game.odds?.[0];
  const homeStats = (game.teamStats ?? []).find((s: any) => s.team?.id === game.homeTeam?.id);
  const awayStats = (game.teamStats ?? []).find((s: any) => s.team?.id === game.awayTeam?.id);
  const homeYtd = useMemo(() => aggregateBoxScore(game.homeTeam?.gameStats ?? []), [game.homeTeam?.gameStats]);
  const awayYtd = useMemo(() => aggregateBoxScore(game.awayTeam?.gameStats ?? []), [game.awayTeam?.gameStats]);

  const showAts = pick?.atsConfidence === 'high' || pick?.atsConfidence === 'medium';
  const showTotal = pick?.totalConfidence === 'high' || pick?.totalConfidence === 'medium';
  if (!showAts && !showTotal) return null;

  const hasScore = game.homePoints != null && game.awayPoints != null;
  const actualSpread = hasScore ? game.awayPoints - game.homePoints : undefined;
  const actualTotal = hasScore ? game.homePoints + game.awayPoints : undefined;
  const modelSpread = pick?.adjustedPredictedMargin != null ? -pick.adjustedPredictedMargin : undefined;

  const atsTeamPicked =
    pick?.atsPick === 'home' ? game.homeTeam?.school : pick?.atsPick === 'away' ? game.awayTeam?.school : undefined;
  const totalPickLabel = pick?.totalPick ? pick.totalPick.toUpperCase() : undefined;

  const atsGrade = showAts ? gradeAts(pick.atsPick, game.homePoints, game.awayPoints, odds?.homeSpread) : undefined;
  const totalGrade = showTotal ? gradeTotal(pick.totalPick, game.homePoints, game.awayPoints, odds?.overUnder) : undefined;

  return (
    <View style={styles.card}>
      <Text style={styles.kickoff}>{formatKickoff(game.startDate)}</Text>
      <Text style={styles.matchup}>
        {game.awayTeam?.school ?? 'Away'} {game.awayPoints ?? '—'} @ {game.homeTeam?.school ?? 'Home'} {game.homePoints ?? '—'}
      </Text>

      {showAts ? (
        <SelectionRow
          label="ATS"
          confidence={pick.atsConfidence}
          pickLabel={atsTeamPicked}
          model={formatSpread(modelSpread)}
          market={formatSpread(odds?.homeSpread)}
          actual={formatSpread(actualSpread)}
          grade={atsGrade}
          bestBetRank={pick.atsBestBetRank}
        />
      ) : null}

      {showTotal ? (
        <SelectionRow
          label="Total"
          confidence={pick.totalConfidence}
          pickLabel={totalPickLabel}
          model={formatTotal(pick?.predictedTotal)}
          market={formatTotal(odds?.overUnder)}
          actual={formatTotal(actualTotal)}
          grade={totalGrade}
          bestBetRank={pick.totalBestBetRank}
        />
      ) : null}

      <MonteCarloRow game={game} pick={pick} />

      <BoxScoreTable
        awayLabel={game.awayTeam?.school ?? 'Away'}
        homeLabel={game.homeTeam?.school ?? 'Home'}
        awayStats={awayStats}
        homeStats={homeStats}
        awayYtd={awayYtd}
        homeYtd={homeYtd}
      />
    </View>
  );
}

// High/medium confidence get a colored highlight (green/orange) rather than
// just the text label — this screen only ever shows high/medium selections
// (low-confidence picks are filtered out above), so every row shown gets one
// of the two.
function SelectionRow({
  label,
  confidence,
  pickLabel,
  model,
  market,
  actual,
  grade,
  bestBetRank,
}: {
  label: string;
  confidence: string | undefined;
  pickLabel: string | undefined;
  model: string;
  market: string;
  actual: string;
  grade: Grade | undefined;
  bestBetRank: number | null | undefined;
}) {
  const highlight = confidence === 'high' ? styles.highlightHigh : confidence === 'medium' ? styles.highlightMedium : null;
  return (
    <View style={[styles.selectionBlock, highlight]}>
      <View style={styles.selectionHeader}>
        <Text style={styles.selectionLabel}>
          {label} ({confidence}){pickLabel ? ` — ${pickLabel}` : ''}
        </Text>
        <Text style={[styles.gradeText, { color: gradeColor(grade) }]}>{grade ? grade.toUpperCase() : '—'}</Text>
      </View>
      <View style={styles.selectionNumbers}>
        <NumberCell label="Model" value={model} />
        <NumberCell label="Market" value={market} />
        <NumberCell label="Actual" value={actual} />
      </View>
      {bestBetRank != null ? <Text style={styles.bestBetBadge}>★ Best Bet #{bestBetRank} that week</Text> : null}
    </View>
  );
}

// Straight-up (not ATS): whichever team the simulation gave >50% win
// probability to going in is its "pick," graded against who actually won.
// Reads the simulation the ETL already ran and froze at kickoff (see
// scripts/etl/ensemble.ts and lib/monteCarlo.ts) rather than recomputing it
// here — this screen needs "what the model thought going in," and only a
// value actually stored at that moment can guarantee that, since sigma or
// weather data could otherwise drift after the fact.
function MonteCarloRow({ game, pick }: { game: any; pick: any }) {
  if (!pick || pick.mcMedianHomeScore == null || pick.mcHomeWinProb == null) return null;

  const predictedHomeWin = pick.mcHomeWinProb > 0.5;
  const actualHomeWin = game.homePoints != null && game.awayPoints != null ? game.homePoints > game.awayPoints : undefined;
  const grade: Grade | undefined = actualHomeWin == null ? undefined : predictedHomeWin === actualHomeWin ? 'win' : 'loss';

  return (
    <View style={styles.selectionBlock}>
      <View style={styles.selectionHeader}>
        <Text style={styles.selectionLabel}>Monte Carlo</Text>
        <Text style={[styles.gradeText, { color: gradeColor(grade) }]}>{grade ? grade.toUpperCase() : '—'}</Text>
      </View>
      <Text style={styles.mcExpected}>
        Expected: {game.awayTeam?.school ?? 'Away'} {pick.mcMedianAwayScore} – {game.homeTeam?.school ?? 'Home'} {pick.mcMedianHomeScore}
      </Text>
    </View>
  );
}

function NumberCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.numberCell}>
      <Text style={styles.numberCellLabel}>{label}</Text>
      <Text style={styles.numberCellValue}>{value}</Text>
    </View>
  );
}

function BoxScoreTable({
  awayLabel,
  homeLabel,
  awayStats,
  homeStats,
  awayYtd,
  homeYtd,
}: {
  awayLabel: string;
  homeLabel: string;
  awayStats: any;
  homeStats: any;
  awayYtd: BoxScoreAgg;
  homeYtd: BoxScoreAgg;
}) {
  return (
    <View>
      <Text style={styles.boxScoreLegend}>Game · Season-to-date</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.boxScoreScroll}>
        <View style={styles.boxScore}>
          <View style={styles.boxScoreRow}>
            <Text style={styles.boxScoreRowLabel} />
            <Text style={styles.boxScoreHeaderCell}>Rush</Text>
            <Text style={styles.boxScoreHeaderCell}>Pass</Text>
            <Text style={styles.boxScoreHeaderCell}>TO</Text>
            <Text style={styles.boxScoreHeaderCell}>Rush TD</Text>
            <Text style={styles.boxScoreHeaderCell}>Pass TD</Text>
            <Text style={styles.boxScoreHeaderCell}>FG</Text>
            <Text style={styles.boxScoreHeaderCell}>Drives</Text>
            <Text style={styles.boxScoreHeaderCell}>Poss</Text>
            <Text style={styles.boxScoreHeaderCell}>1st Dn</Text>
            <Text style={styles.boxScoreHeaderCell}>3rd Dn</Text>
            <Text style={styles.boxScoreHeaderCell}>Pen</Text>
          </View>
          <BoxScoreRow label={awayLabel} stats={awayStats} ytd={awayYtd} />
          <BoxScoreRow label={homeLabel} stats={homeStats} ytd={homeYtd} />
        </View>
      </ScrollView>
    </View>
  );
}

function BoxScoreRow({ label, stats, ytd }: { label: string; stats: any; ytd: BoxScoreAgg }) {
  return (
    <View style={styles.boxScoreRow}>
      <Text style={styles.boxScoreRowLabel} numberOfLines={1}>
        {label}
      </Text>
      <StatCell value={stats?.rushingYards} ytd={ytd.rushingYards} />
      <StatCell value={stats?.passingYards} ytd={ytd.passingYards} />
      <StatCell value={stats?.turnovers} ytd={ytd.turnovers} />
      <StatCell value={stats?.rushingTDs} ytd={ytd.rushingTDs} />
      <StatCell value={stats?.passingTDs} ytd={ytd.passingTDs} />
      <StatCell value={stats?.fieldGoals} ytd={ytd.fieldGoals} />
      <StatCell value={stats?.drives} ytd={ytd.drives} />
      <StatCell value={stats?.possessionTime} ytd={ytd.possessionTime} />
      <StatCell value={stats?.firstDowns} ytd={ytd.firstDowns} />
      <StatCell value={stats?.thirdDownConv} ytd={ytd.thirdDownConv} />
      <StatCell value={stats?.penalties} ytd={ytd.penalties} />
    </View>
  );
}

function StatCell({ value, ytd }: { value: string | number | undefined | null; ytd: string | number | undefined }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statCellValue}>{value ?? '—'}</Text>
      <View style={styles.statCellDivider} />
      <Text style={styles.statCellYtd}>{ytd ?? '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f6f8fa',
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
  list: {
    padding: 12,
    gap: 10,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  kickoff: {
    fontSize: 11,
    fontWeight: '700',
    color: '#57606a',
  },
  matchup: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0b1d3a',
  },
  selectionBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d0d7de',
    paddingTop: 6,
    gap: 4,
  },
  highlightHigh: {
    backgroundColor: '#dafbe1',
    borderTopWidth: 0,
    borderLeftWidth: 4,
    borderLeftColor: '#1a7f37',
    paddingLeft: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  highlightMedium: {
    backgroundColor: '#ffe9d6',
    borderTopWidth: 0,
    borderLeftWidth: 4,
    borderLeftColor: '#bf5b04',
    paddingLeft: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  selectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#57606a',
  },
  gradeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  selectionNumbers: {
    flexDirection: 'row',
    gap: 16,
  },
  numberCell: {
    gap: 1,
  },
  numberCellLabel: {
    fontSize: 10,
    color: '#8b949e',
  },
  numberCellValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0b1d3a',
  },
  mcExpected: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0b1d3a',
  },
  bestBetBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9a6700',
    marginTop: 2,
  },
  boxScoreLegend: {
    fontSize: 10,
    color: '#8b949e',
    marginTop: 6,
    marginBottom: 2,
  },
  boxScoreScroll: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d0d7de',
    paddingTop: 4,
  },
  boxScore: {
    gap: 4,
  },
  boxScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  boxScoreRowLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0b1d3a',
    width: 90,
  },
  boxScoreHeaderCell: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8b949e',
    width: 68,
    textAlign: 'center',
  },
  statCell: {
    width: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  statCellValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#57606a',
  },
  statCellDivider: {
    width: 1,
    height: 12,
    backgroundColor: '#d0d7de',
  },
  statCellYtd: {
    fontSize: 11,
    fontWeight: '500',
    color: '#8b949e',
  },
});
