// Display-shape types for query results, kept independent of InstantDB's
// generated schema types so the UI layer doesn't have to fight deep generic
// inference for optional/linked fields.

export interface TeamView {
  id: string;
  school: string;
  abbreviation?: string;
  logoUrl?: string;
  talentScore?: number;
  pollRank?: number;
}

export interface RecruitingClassView {
  rank?: number;
  points?: number;
  fiveStars: number;
  fourStars: number;
  threeStars: number;
  twoStars: number;
  commitCount: number;
}

export interface PortalTransferView {
  firstName: string;
  lastName: string;
  position?: string;
  originName?: string;
  destinationName?: string;
  rating?: number;
  stars?: number;
  topPortalPlayer: boolean;
}

// Whole-roster continuity, not literally "returning starters" — CFBD has no
// starter/snap-count designation. See scripts/etl/upsertRecruitingPortal.ts.
export interface RosterContinuityView {
  offenseReturning: number;
  defenseReturning: number;
}

export interface WeatherView {
  tempF?: number;
  windMph?: number;
  windDir?: string;
  precipProb?: number;
}

export interface VenueView {
  id: string;
  name: string;
  city?: string;
  state?: string;
  capacity?: number;
  dome?: boolean;
}

// Market/pick fields are `| null`, not just `?`/undefined, because InstantDB
// stores an explicit null to clear a field a previous ETL run had set (e.g.
// an edge that shrank back under a pick's threshold) — see the comment on
// the ensemble_picks write in scripts/etl/ensemble.ts.
export interface PickView {
  atsPick?: string | null;
  atsConfidence?: string | null;
  totalPick?: string | null;
  totalConfidence?: string | null;
  mlPick?: string | null;
  mlEdge?: number | null;
  marketHomeSpread?: number | null;
  marketTotal?: number | null;
  predictedTotal?: number | null;
  adjustedPredictedMargin?: number;
  adjustmentNotes?: string;
}

export interface GameView {
  id: string;
  season: number;
  week: number;
  startDate: string;
  neutralSite: boolean;
  tv?: string;
  homeTeam?: TeamView;
  awayTeam?: TeamView;
  venue?: VenueView;
  pick?: PickView;
  weather?: WeatherView;
}
