// Display-shape types for query results, kept independent of InstantDB's
// generated schema types so the UI layer doesn't have to fight deep generic
// inference for optional/linked fields.

export interface TeamView {
  id: string;
  school: string;
  abbreviation?: string;
  logoUrl?: string;
  talentScore?: number;
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

export interface PickView {
  atsPick?: string;
  atsConfidence?: string;
  totalPick?: string;
  totalConfidence?: string;
  mlPick?: string;
  mlEdge?: number;
  marketHomeSpread?: number;
  marketTotal?: number;
  predictedTotal?: number;
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
