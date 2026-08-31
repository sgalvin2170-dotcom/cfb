// Season-to-date box score aggregation for Post-Game Analysis's "game | YTD"
// display. game_team_stats has no season field of its own — safe to sum a
// team's whole gameStats reverse-relation unfiltered only because this table
// didn't exist before the 2026 season, so nothing prior-season is in it yet;
// this assumption will need a season filter once that's no longer true.
export interface BoxScoreRow {
  rushingYards?: number | null;
  passingYards?: number | null;
  turnovers?: number | null;
  rushingTDs?: number | null;
  passingTDs?: number | null;
  fieldGoals?: string | null;
  drives?: number | null;
  possessionTime?: string | null;
  firstDowns?: number | null;
  thirdDownConv?: string | null;
  penalties?: string | null;
}

export interface BoxScoreAgg {
  rushingYards?: number;
  passingYards?: number;
  turnovers?: number;
  rushingTDs?: number;
  passingTDs?: number;
  fieldGoals?: string;
  drives?: number;
  possessionTime?: string;
  firstDowns?: number;
  thirdDownConv?: string;
  penalties?: string;
}

function sumNumbers(values: (number | null | undefined)[]): number | undefined {
  const nums = values.filter((v): v is number => v != null);
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : undefined;
}

// "7-16" style (3rd down conversions, penalties) — summed component-wise.
function sumDashFormat(values: (string | null | undefined)[]): string | undefined {
  let a = 0;
  let b = 0;
  let any = false;
  for (const v of values) {
    if (!v) continue;
    const [x, y] = v.split('-').map(Number);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    a += x;
    b += y;
    any = true;
  }
  return any ? `${a}-${b}` : undefined;
}

// "1/1" style (field goals) — summed component-wise.
function sumFractionFormat(values: (string | null | undefined)[]): string | undefined {
  let made = 0;
  let attempted = 0;
  let any = false;
  for (const v of values) {
    if (!v) continue;
    const [m, a] = v.split('/').map(Number);
    if (Number.isNaN(m) || Number.isNaN(a)) continue;
    made += m;
    attempted += a;
    any = true;
  }
  return any ? `${made}/${attempted}` : undefined;
}

function possessionToSeconds(mmss: string | null | undefined): number | undefined {
  if (!mmss) return undefined;
  const [m, s] = mmss.split(':').map(Number);
  if (Number.isNaN(m) || Number.isNaN(s)) return undefined;
  return m * 60 + s;
}

function secondsToPossession(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Unlike every other stat here, possession is averaged per game, not
// summed — a season total in minutes isn't a meaningful number the way a
// per-game average is.
function avgPossession(values: (string | null | undefined)[]): string | undefined {
  const secs = values.map(possessionToSeconds).filter((v): v is number => v != null);
  return secs.length > 0 ? secondsToPossession(secs.reduce((a, b) => a + b, 0) / secs.length) : undefined;
}

export function aggregateBoxScore(rows: BoxScoreRow[]): BoxScoreAgg {
  return {
    rushingYards: sumNumbers(rows.map((r) => r.rushingYards)),
    passingYards: sumNumbers(rows.map((r) => r.passingYards)),
    turnovers: sumNumbers(rows.map((r) => r.turnovers)),
    rushingTDs: sumNumbers(rows.map((r) => r.rushingTDs)),
    passingTDs: sumNumbers(rows.map((r) => r.passingTDs)),
    fieldGoals: sumFractionFormat(rows.map((r) => r.fieldGoals)),
    drives: sumNumbers(rows.map((r) => r.drives)),
    possessionTime: avgPossession(rows.map((r) => r.possessionTime)),
    firstDowns: sumNumbers(rows.map((r) => r.firstDowns)),
    thirdDownConv: sumDashFormat(rows.map((r) => r.thirdDownConv)),
    penalties: sumDashFormat(rows.map((r) => r.penalties)),
  };
}
