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
