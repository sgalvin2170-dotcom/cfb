// InstantDB schema for the CFB Predictor app.
//
// Naming convention: fields prefixed `cfbd*` hold CollegeFootballData.com's
// canonical IDs/strings, which this schema treats as the source of truth for
// team/venue/game identity (see team_aliases for reconciling other sources'
// free-text team names against these canonical IDs).
//
// After editing this file, push it with: npx instant-cli@latest push schema
//
// Imports `i` from @instantdb/core (not @instantdb/react-native) because this
// file is shared between the RN app and the Node-based ETL scripts — pulling
// it in from the react-native package drags in react-native's own source,
// which esbuild/tsx can't transform outside of Metro's Flow-aware pipeline.
import { i } from '@instantdb/core';

const _schema = i.schema({
  entities: {
    teams: i.entity({
      cfbdTeamId: i.number().unique().indexed(),
      espnTeamId: i.string().optional(),
      school: i.string().indexed(),
      mascot: i.string().optional(),
      abbreviation: i.string().optional(),
      conference: i.string().optional(),
      logoUrl: i.string().optional(),
      primaryColor: i.string().optional(),
    }),

    // Reconciles a source's free-text team name to a canonical team, since
    // Sagarin/TeamRankings/FEI/PredictionTracker each spell names differently
    // (e.g. "Ohio St." vs "Ohio State" vs "OSU").
    team_aliases: i.entity({
      source: i.string().indexed(),
      sourceTeamString: i.string().indexed(),
    }),

    venues: i.entity({
      cfbdVenueId: i.number().unique().indexed(),
      name: i.string(),
      city: i.string().optional(),
      state: i.string().optional(),
      capacity: i.number().optional(),
      dome: i.boolean().optional(),
      grass: i.boolean().optional(),
      lat: i.number().optional(),
      lng: i.number().optional(),
      elevation: i.number().optional(),
    }),

    games: i.entity({
      cfbdGameId: i.number().unique().indexed(),
      season: i.number().indexed(),
      week: i.number().indexed(),
      seasonType: i.string(),
      startDate: i.date().indexed(),
      neutralSite: i.boolean(),
      tv: i.string().optional(),
    }),

    // Tidy/long format so every rating source (including ESPN FPI's several
    // metrics per team) fits one shape: one row per (source, team, metric, date).
    ratings_raw: i.entity({
      source: i.string().indexed(),
      season: i.number().indexed(),
      asOfDate: i.date().indexed(),
      metricName: i.string().indexed(),
      value: i.number(),
      scrapedAt: i.date(),
    }),

    odds: i.entity({
      source: i.string().indexed(),
      sportsbook: i.string().optional(),
      homeSpread: i.number().optional(),
      overUnder: i.number().optional(),
      homeMoneyline: i.number().optional(),
      awayMoneyline: i.number().optional(),
      capturedAt: i.date(),
    }),

    talent: i.entity({
      season: i.number().indexed(),
      talentScore: i.number(),
    }),

    injuries: i.entity({
      playerName: i.string(),
      position: i.string().optional(),
      status: i.string(),
      source: i.string(),
      reportedAt: i.date(),
    }),

    weather: i.entity({
      forecastAt: i.date(),
      tempF: i.number().optional(),
      windMph: i.number().optional(),
      windDir: i.string().optional(),
      precipProb: i.number().optional(),
      isDome: i.boolean(),
    }),

    ensemble_picks: i.entity({
      modelVersion: i.string().indexed(),
      rawPredictedMargin: i.number(),
      adjustedPredictedMargin: i.number(),
      predictedTotal: i.number().optional(),
      predictedHomeWinProb: i.number().optional(),
      marketHomeSpread: i.number().optional(),
      marketTotal: i.number().optional(),
      marketImpliedHomeProb: i.number().optional(),
      atsPick: i.string().optional(),
      atsConfidence: i.string().optional(),
      totalPick: i.string().optional(),
      totalConfidence: i.string().optional(),
      mlPick: i.string().optional(),
      mlEdge: i.number().optional(),
      adjustmentNotes: i.string().optional(),
      computedAt: i.date(),
    }),

    model_weights: i.entity({
      modelVersion: i.string().indexed(),
      sourceName: i.string(),
      weight: i.number(),
      trainedAt: i.date(),
      backtestSampleSize: i.number().optional(),
      backtestATSPct: i.number().optional(),
    }),

    scrape_runs: i.entity({
      source: i.string().indexed(),
      startedAt: i.date(),
      finishedAt: i.date().indexed().optional(),
      status: i.string(),
      rowsWritten: i.number().optional(),
      errorMessage: i.string().optional(),
    }),
  },

  links: {
    gameHomeTeam: {
      forward: { on: 'games', has: 'one', label: 'homeTeam' },
      reverse: { on: 'teams', has: 'many', label: 'homeGames' },
    },
    gameAwayTeam: {
      forward: { on: 'games', has: 'one', label: 'awayTeam' },
      reverse: { on: 'teams', has: 'many', label: 'awayGames' },
    },
    gameVenue: {
      forward: { on: 'games', has: 'one', label: 'venue' },
      reverse: { on: 'venues', has: 'many', label: 'games' },
    },
    aliasTeam: {
      forward: { on: 'team_aliases', has: 'one', label: 'team' },
      reverse: { on: 'teams', has: 'many', label: 'aliases' },
    },
    ratingTeam: {
      forward: { on: 'ratings_raw', has: 'one', label: 'team' },
      reverse: { on: 'teams', has: 'many', label: 'ratings' },
    },
    oddsGame: {
      forward: { on: 'odds', has: 'one', label: 'game' },
      reverse: { on: 'games', has: 'many', label: 'odds' },
    },
    talentTeam: {
      forward: { on: 'talent', has: 'one', label: 'team' },
      reverse: { on: 'teams', has: 'many', label: 'talent' },
    },
    injuryTeam: {
      forward: { on: 'injuries', has: 'one', label: 'team' },
      reverse: { on: 'teams', has: 'many', label: 'injuries' },
    },
    weatherGame: {
      forward: { on: 'weather', has: 'one', label: 'game' },
      reverse: { on: 'games', has: 'many', label: 'weatherForecasts' },
    },
    pickGame: {
      forward: { on: 'ensemble_picks', has: 'one', label: 'game' },
      reverse: { on: 'games', has: 'many', label: 'ensemblePicks' },
    },
  },
});

// TypeScript-only aliasing so `import schema from './instant.schema'` gets
// strong types without re-exporting internal Instant helper types.
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
