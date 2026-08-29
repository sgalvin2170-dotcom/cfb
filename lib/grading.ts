// Grades a completed game's ATS/Total pick against the frozen pregame market
// line (see scripts/etl/upsertCore.ts's upsertOdds — odds stop updating once
// a game kicks off, so `marketHomeSpread`/`marketTotal` here are always the
// true last-seen pregame numbers, never something that drifted after the
// fact).
export type Grade = 'win' | 'loss' | 'push';

export function gradeAts(
  atsPick: string | undefined | null,
  homePoints: number | undefined | null,
  awayPoints: number | undefined | null,
  marketHomeSpread: number | undefined | null, // CFBD convention: negative = home favored
): Grade | undefined {
  if (!atsPick || homePoints == null || awayPoints == null || marketHomeSpread == null) return undefined;
  const actualMargin = homePoints - awayPoints;
  const marketHomeMargin = -marketHomeSpread;
  if (actualMargin === marketHomeMargin) return 'push';
  const homeCovered = actualMargin > marketHomeMargin;
  const picked = atsPick === 'home' ? homeCovered : !homeCovered;
  return picked ? 'win' : 'loss';
}

export function gradeTotal(
  totalPick: string | undefined | null,
  homePoints: number | undefined | null,
  awayPoints: number | undefined | null,
  marketTotal: number | undefined | null,
): Grade | undefined {
  if (!totalPick || homePoints == null || awayPoints == null || marketTotal == null) return undefined;
  const actualTotal = homePoints + awayPoints;
  if (actualTotal === marketTotal) return 'push';
  const wentOver = actualTotal > marketTotal;
  const picked = totalPick === 'over' ? wentOver : !wentOver;
  return picked ? 'win' : 'loss';
}

export function gradeColor(grade: Grade | undefined): string {
  switch (grade) {
    case 'win':
      return '#1a7f37';
    case 'loss':
      return '#cf222e';
    case 'push':
      return '#9a6700';
    default:
      return '#57606a';
  }
}
