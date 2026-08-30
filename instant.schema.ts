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
      espnTeamId: i.string().unique().indexed().optional(),
      school: i.string().unique().indexed(),
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
      completed: i.boolean().indexed().optional(),
      homePoints: i.number().optional(),
      awayPoints: i.number().optional(),
    }),

    // Tidy/long format so every rating source (including ESPN FPI's several
    // metrics per team) fits one shape: one row per (source, team, metric, date).
    ratings_raw: i.entity({
      // "{source}:{teamId}:{metricName}:{scrape day}" — upserts idempotently
      // so re-running the ETL the same day overwrites instead of piling up
      // duplicates, while still keeping one row per distinct day over a season.
      ratingKey: i.string().unique().indexed(),
      source: i.string().indexed(),
      season: i.number().indexed(),
      asOfDate: i.date().indexed(),
      metricName: i.string().indexed(),
      value: i.number(),
      scrapedAt: i.date().indexed(),
    }),

    odds: i.entity({
      // "{cfbdGameId}:{source}" — lets the ETL upsert idempotently instead
      // of appending a fresh row on every run.
      oddsKey: i.string().unique().indexed(),
      source: i.string().indexed(),
      sportsbook: i.string().optional(),
      homeSpread: i.number().optional(),
      openHomeSpread: i.number().optional(),
      overUnder: i.number().optional(),
      openOverUnder: i.number().optional(),
      homeMoneyline: i.number().optional(),
      awayMoneyline: i.number().optional(),
      capturedAt: i.date(),
    }),

    talent: i.entity({
      // "{teamId}:{season}" — idempotent upsert key.
      talentKey: i.string().unique().indexed(),
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
      // "{cfbdGameId}" — one row per game, overwritten as the forecast
      // improves on closer-to-kickoff runs.
      weatherKey: i.string().unique().indexed(),
      forecastAt: i.date(),
      tempF: i.number().optional(),
      windMph: i.number().optional(),
      windDir: i.string().optional(),
      precipProb: i.number().optional(),
      isDome: i.boolean(),
    }),

    ensemble_picks: i.entity({
      // "{modelVersion}:{cfbdGameId}" — lets the ETL upsert idempotently
      // instead of appending a fresh row every run, while still letting
      // multiple model versions coexist for later backtest comparison.
      pickKey: i.string().unique().indexed(),
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
      computedAt: i.date().indexed(),
    }),

    model_weights: i.entity({
      // "{modelVersion}:{sourceName}" — idempotent upsert key, so retraining
      // overwrites instead of accumulating duplicate rows. sourceName
      // "intercept" holds the fitted calibration constant (a plain number
      // field, not a per-source weight — ensemble.ts special-cases it).
      weightKey: i.string().unique().indexed(),
      modelVersion: i.string().indexed(),
      sourceName: i.string(),
      weight: i.number(),
      trainedAt: i.date(),
      backtestSampleSize: i.number().optional(),
      backtestATSPct: i.number().optional(),
    }),

    // Top-25 poll rank per team per CFBD week (ESPN's hidden rankings API,
    // team matched by embedded ESPN team id — no fuzzy name matching
    // needed). Keyed by week (not just season) since rank changes weekly;
    // see scripts/etl/sources/espnRankings.ts for how a CFBD week resolves
    // to the right underlying ESPN poll.
    poll_rankings: i.entity({
      // "{teamId}:{season}:{week}:{pollId}" — idempotent upsert key.
      pollRankKey: i.string().unique().indexed(),
      season: i.number().indexed(),
      week: i.number().indexed(),
      pollId: i.string().indexed(),
      pollName: i.string(),
      rank: i.number(),
      previousRank: i.number().optional(),
      points: i.number().optional(),
      firstPlaceVotes: i.number().optional(),
    }),

    // One row per team per signing class (247Sports Composite, via CFBD's
    // /recruiting/teams + /recruiting/players — CFBD's numbers matched
    // 247Sports' own page exactly when checked, so no separate scrape needed).
    recruiting_classes: i.entity({
      // "{teamId}:{year}" — idempotent upsert key.
      recruitKey: i.string().unique().indexed(),
      season: i.number().indexed(),
      rank: i.number().optional(),
      points: i.number().optional(),
      fiveStars: i.number(),
      fourStars: i.number(),
      threeStars: i.number(),
      twoStars: i.number(),
      commitCount: i.number(),
    }),

    // One row per transfer-portal entry (CFBD /player/portal). `portalRank`
    // is this entry's leaguewide rank by CFBD's composite rating among all
    // rated entries for the season (nulls unranked); topPortalPlayer flags
    // the top 100 by that rank as a stand-in for "notable portal players"
    // since no clean scrapable per-team top-100 list exists.
    portal_transfers: i.entity({
      // "{season}:{firstName}:{lastName}:{origin}:{destination}:{transferDate}"
      transferKey: i.string().unique().indexed(),
      season: i.number().indexed(),
      firstName: i.string(),
      lastName: i.string(),
      position: i.string().optional(),
      originName: i.string().optional(),
      destinationName: i.string().optional(),
      transferDate: i.date(),
      rating: i.number().optional(),
      stars: i.number().optional(),
      eligibility: i.string().optional(),
      portalRank: i.number().optional(),
      topPortalPlayer: i.boolean(),
    }),

    // Roster continuity, derived by diffing this season's CFBD /roster
    // against last season's by player id. Not literally "starters" — CFBD
    // has no starter/snap-count designation — so this counts whole-roster
    // continuity split by offense/defense position group; the UI labels it
    // accordingly. Empty until CFBD publishes the current season's roster
    // (same resilience pattern as talent/recruiting: preseason = no data yet).
    roster_continuity: i.entity({
      // "{teamId}:{year}" — idempotent upsert key.
      continuityKey: i.string().unique().indexed(),
      season: i.number().indexed(),
      offenseReturning: i.number(),
      defenseReturning: i.number(),
      computedAt: i.date(),
    }),

    // Current head coach per team — a single upserted snapshot (like
    // `weather`/`talent`), not an accumulating per-day log like
    // `ratings_raw`: only "who's the coach right now and what's their
    // record" matters here, so re-running the ETL overwrites the same row
    // instead of piling up history.
    coaches: i.entity({
      // "{teamId}" — idempotent upsert key, one row per team.
      coachKey: i.string().unique().indexed(),
      firstName: i.string(),
      lastName: i.string(),
      hireDate: i.date().optional(),
      yearsAtSchool: i.number(),
      wins: i.number(),
      losses: i.number(),
      ties: i.number(),
      careerWins: i.number(),
      careerLosses: i.number(),
      careerTies: i.number(),
      computedAt: i.date().indexed(),
    }),

    // Final box-score stats, one row per team per completed game. CFBD's
    // /games/teams returns a flat category/stat string-pair list (~25
    // categories, most not relevant here) rather than a typed schema — this
    // keeps just the Post-Game Analysis needs. `netPassingYards` is CFBD's
    // own category name (stored here as `passingYards` for display
    // clarity); `possessionTime`/`thirdDownConv`/`penalties` stay as CFBD's
    // raw "MM:SS"/"7-12"/"2-25" strings. `fieldGoals` ("2/3") and `drives` come from
    // two additional endpoints (/games/players, /drives) that /games/teams
    // doesn't cover — see upsertGameTeamStats.ts for why those are gated
    // more carefully than the rest of this table.
    game_team_stats: i.entity({
      // "{cfbdGameId}:{teamId}" — idempotent upsert key; a completed game's
      // box score never changes, so re-fetching just overwrites with the
      // same values.
      statsKey: i.string().unique().indexed(),
      rushingYards: i.number().optional(),
      passingYards: i.number().optional(),
      turnovers: i.number().optional(),
      possessionTime: i.string().optional(),
      thirdDownConv: i.string().optional(),
      rushingTDs: i.number().optional(),
      passingTDs: i.number().optional(),
      fieldGoals: i.string().optional(),
      drives: i.number().optional(),
      firstDowns: i.number().optional(),
      penalties: i.string().optional(),
      computedAt: i.date().indexed(),
    }),

    // Preseason roster-composition score per team — a single upserted
    // snapshot (like `coaches`/`talent`), not accumulated history. Raw
    // inputs (roster_continuity's whole-roster overlap count, summed
    // incoming-transfer rating, 247Sports composite points) are on
    // unrelated, arbitrary scales, so every component here is a
    // league-wide percentile (0-100) rather than a raw value — see
    // scripts/etl/upsertPreseasonScores.ts for exactly how each is derived
    // and the formula that blends them.
    preseason_scores: i.entity({
      // "{teamId}:{season}" — idempotent upsert key.
      scoreKey: i.string().unique().indexed(),
      season: i.number().indexed(),
      talentPercentile: i.number(),
      returningProductionScore: i.number(),
      transferPortalScore: i.number(),
      recruitingScore: i.number(),
      rosterScore: i.number(),
      computedAt: i.date().indexed(),
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
    pollRankingTeam: {
      forward: { on: 'poll_rankings', has: 'one', label: 'team' },
      reverse: { on: 'teams', has: 'many', label: 'pollRankings' },
    },
    recruitingClassTeam: {
      forward: { on: 'recruiting_classes', has: 'one', label: 'team' },
      reverse: { on: 'teams', has: 'many', label: 'recruitingClasses' },
    },
    portalOriginTeam: {
      forward: { on: 'portal_transfers', has: 'one', label: 'originTeam' },
      reverse: { on: 'teams', has: 'many', label: 'portalOut' },
    },
    portalDestinationTeam: {
      forward: { on: 'portal_transfers', has: 'one', label: 'destinationTeam' },
      reverse: { on: 'teams', has: 'many', label: 'portalIn' },
    },
    rosterContinuityTeam: {
      forward: { on: 'roster_continuity', has: 'one', label: 'team' },
      reverse: { on: 'teams', has: 'many', label: 'rosterContinuity' },
    },
    coachTeam: {
      forward: { on: 'coaches', has: 'one', label: 'team' },
      reverse: { on: 'teams', has: 'many', label: 'coaches' },
    },
    preseasonScoreTeam: {
      forward: { on: 'preseason_scores', has: 'one', label: 'team' },
      reverse: { on: 'teams', has: 'many', label: 'preseasonScores' },
    },
    gameTeamStatsGame: {
      forward: { on: 'game_team_stats', has: 'one', label: 'game' },
      reverse: { on: 'games', has: 'many', label: 'teamStats' },
    },
    gameTeamStatsTeam: {
      forward: { on: 'game_team_stats', has: 'one', label: 'team' },
      reverse: { on: 'teams', has: 'many', label: 'gameStats' },
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
