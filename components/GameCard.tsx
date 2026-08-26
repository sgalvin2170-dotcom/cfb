import { Link } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { confidenceColor, formatKickoffTime, formatSpread, formatTotal } from '../lib/format';
import type { GameView, TeamView } from '../lib/types';

// ML has no stored confidence tier (unlike ATS/Total) — mirrors the
// threshold used to rank Best Bets (app/(dashboard)/best-bets.tsx) so the
// same edge reads as the same confidence everywhere in the app.
const ML_HIGH_EDGE = 0.1;

function teamLabel(team?: TeamView): string {
  return team?.abbreviation ?? team?.school ?? 'TBD';
}

export default function GameCard({ game }: { game: GameView }) {
  const pick = game.pick;
  const hasMarket = pick?.marketHomeSpread != null;

  // Both columns use the same "gambling spread" sign convention (negative =
  // favored) so a team's market and model numbers read directly side by
  // side — home's own predicted margin (positive = home favored) has to be
  // negated to match that convention; away is just its mirror.
  const homeMarket = pick?.marketHomeSpread;
  const awayMarket = pick?.marketHomeSpread != null ? -pick.marketHomeSpread : undefined;
  const homeModel = pick?.adjustedPredictedMargin != null ? -pick.adjustedPredictedMargin : undefined;
  const awayModel = pick?.adjustedPredictedMargin;

  const atsTeam = pick?.atsPick === 'home' ? teamLabel(game.homeTeam) : pick?.atsPick === 'away' ? teamLabel(game.awayTeam) : undefined;
  const mlTeam = pick?.mlPick === 'home' ? teamLabel(game.homeTeam) : pick?.mlPick === 'away' ? teamLabel(game.awayTeam) : undefined;
  const mlConfidence = pick?.mlPick ? (pick.mlEdge != null && Math.abs(pick.mlEdge) >= ML_HIGH_EDGE ? 'high' : 'medium') : undefined;

  return (
    <Link href={{ pathname: '/game/[id]', params: { id: game.id } }} asChild>
      <Pressable style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.kickoff}>{formatKickoffTime(game.startDate)}</Text>
          <View style={styles.tagRow}>
            {game.venue?.dome ? <Text style={styles.domeTag}>DOME</Text> : null}
            {!game.venue?.dome && game.weather?.windMph != null && game.weather.windMph >= 15 ? (
              <Text style={styles.windTag}>💨{Math.round(game.weather.windMph)}</Text>
            ) : null}
          </View>
          {hasMarket ? (
            <View style={styles.colHeaders}>
              <Text style={styles.colHeaderText}>MKT</Text>
              <Text style={styles.colHeaderText}>MODEL</Text>
            </View>
          ) : null}
        </View>

        <TeamRow team={game.awayTeam} market={awayMarket} model={awayModel} />
        <TeamRow team={game.homeTeam} market={homeMarket} model={homeModel} />
        <TotalRow market={pick?.marketTotal} model={pick?.predictedTotal} />

        {pick ? (
          <View style={styles.picksRow}>
            <PickChip label="ATS" value={atsTeam ?? 'no-lean'} confidence={pick.atsPick ? pick.atsConfidence : undefined} />
            <PickChip label="Total" value={pick.totalPick?.toUpperCase() ?? 'NO-LEAN'} confidence={pick.totalPick ? pick.totalConfidence : undefined} />
            <PickChip label="ML" value={mlTeam ?? 'no-lean'} confidence={mlConfidence} />
          </View>
        ) : (
          <Text style={styles.noPick}>No pick yet — awaiting data</Text>
        )}
        {!hasMarket && pick ? <Text style={styles.noMarketNote}>No market line yet</Text> : null}
      </Pressable>
    </Link>
  );
}

function TeamRow({ team, market, model }: { team?: TeamView; market?: number; model?: number }) {
  return (
    <View style={styles.teamRow}>
      {team?.logoUrl ? (
        <Image source={{ uri: team.logoUrl }} style={styles.logo} resizeMode="contain" />
      ) : (
        <View style={styles.logoFallback} />
      )}
      {team?.pollRank != null ? <Text style={styles.rankBadge}>#{team.pollRank}</Text> : null}
      <Text style={styles.teamName} numberOfLines={1}>
        {teamLabel(team)}
      </Text>
      {market != null || model != null ? (
        <View style={styles.numCols}>
          <Text style={styles.numText}>{formatSpread(market)}</Text>
          <Text style={[styles.numText, styles.numTextModel]}>{formatSpread(model)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function TotalRow({ market, model }: { market?: number; model?: number }) {
  if (market == null && model == null) return null;
  return (
    <View style={styles.teamRow}>
      <View style={styles.ouSpacer} />
      <Text style={styles.teamName} numberOfLines={1}>
        O/U
      </Text>
      <View style={styles.numCols}>
        <Text style={styles.numText}>{formatTotal(market)}</Text>
        <Text style={[styles.numText, styles.numTextModel]}>{formatTotal(model)}</Text>
      </View>
    </View>
  );
}

function PickChip({ label, value, confidence }: { label: string; value: string; confidence?: string }) {
  const color = confidenceColor(confidence);
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      {confidence ? <Text style={[styles.chipConfidence, { color }]}>{confidence.toUpperCase()}</Text> : null}
      <Text style={styles.chipText} numberOfLines={1}>
        {label}: {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    marginVertical: 5,
    width: 248,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
    gap: 3,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  kickoff: {
    fontSize: 11,
    fontWeight: '700',
    color: '#57606a',
  },
  tagRow: {
    flexDirection: 'row',
    gap: 4,
    marginLeft: 6,
  },
  domeTag: {
    fontSize: 9,
    fontWeight: '700',
    color: '#0969da',
    backgroundColor: '#ddf4ff',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  windTag: {
    fontSize: 9,
    fontWeight: '700',
    color: '#9a6700',
    backgroundColor: '#fff8c5',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  colHeaders: {
    flexDirection: 'row',
    marginLeft: 'auto',
    gap: 10,
  },
  colHeaderText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#8b949e',
    width: 36,
    textAlign: 'right',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logo: {
    width: 16,
    height: 16,
  },
  logoFallback: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#d0d7de',
  },
  ouSpacer: {
    width: 16,
    height: 16,
  },
  teamName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0b1d3a',
    flexShrink: 1,
    flexGrow: 1,
  },
  rankBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9a6700',
  },
  numCols: {
    flexDirection: 'row',
    gap: 10,
  },
  numText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#57606a',
    width: 36,
    textAlign: 'right',
  },
  numTextModel: {
    color: '#0b1d3a',
  },
  picksRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  chip: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    gap: 0,
  },
  chipConfidence: {
    fontSize: 7,
    fontWeight: '800',
  },
  chipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0b1d3a',
  },

  noPick: {
    fontSize: 11,
    color: '#8b949e',
    fontStyle: 'italic',
    marginTop: 6,
  },
  noMarketNote: {
    fontSize: 10,
    color: '#8b949e',
    fontStyle: 'italic',
    marginTop: 2,
  },
});
