// ESPN's hidden FPI API. The `items[].team.$ref` field is a URL whose last
// path segment before the querystring is ESPN's numeric team id — reading it
// out of the URL avoids resolving 138 extra $ref requests, and lines up with
// the espnTeamId we already store on `teams` from the logos fetch.
import { env } from '../env';

const URL_TEMPLATE = (year: number) =>
  `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${year}/powerindex?limit=200`;

interface EspnPowerIndexResponse {
  items: Array<{
    team: { $ref: string };
    lastUpdated?: string;
    predictives: Array<{ name: string; value: number }>;
  }>;
}

export interface EspnFpiRow {
  espnTeamId: string;
  asOfDate: string;
  metrics: Record<string, number>;
}

const TEAM_ID_RE = /\/teams\/(\d+)\?/;

// These are the predictive metric names we actually care about for the
// ensemble/display; ESPN's response has ~30 fields per team (win
// probabilities, playoff odds, etc.) that aren't relevant here.
const WANTED_METRICS = new Set(['fpi', 'epaoffense', 'epadefense', 'epaspecialteams']);

export async function fetchEspnFpi(year: number = env.season): Promise<EspnFpiRow[]> {
  const res = await fetch(URL_TEMPLATE(year), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`ESPN FPI fetch failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as EspnPowerIndexResponse;

  const rows: EspnFpiRow[] = [];
  for (const item of json.items) {
    const idMatch = item.team.$ref.match(TEAM_ID_RE);
    if (!idMatch) continue;

    const metrics: Record<string, number> = {};
    for (const p of item.predictives) {
      if (WANTED_METRICS.has(p.name) && typeof p.value === 'number') {
        metrics[p.name] = p.value;
      }
    }
    if (Object.keys(metrics).length === 0) continue;

    rows.push({
      espnTeamId: idMatch[1],
      asOfDate: item.lastUpdated ?? new Date().toISOString(),
      metrics,
    });
  }
  return rows;
}
