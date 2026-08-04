// ESPN's public site API — used only for team logos/colors, since CFBD
// doesn't reliably provide hosted logo images. Public JSON endpoint, no key.
import { normalize } from '../teamMatch';

const TEAMS_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?group=80&limit=1000';

interface EspnTeamsResponse {
  sports: Array<{
    leagues: Array<{
      teams: Array<{
        team: {
          id: string;
          displayName: string;
          // School name without the mascot (e.g. "Alabama", not "Alabama
          // Crimson Tide"). Matching on this instead of displayName is what
          // makes the join reliable — ESPN has near-name-collisions like
          // "Alabama" vs "Alabama A&M" vs "Alabama State", and matching on
          // the full mascot-suffixed displayName made those genuinely
          // ambiguous (a prefix/length heuristic once matched CFBD's
          // "Alabama" to ESPN's "Alabama A&M Bulldogs" by coincidence of
          // string length). `location` is an exact match for the vast
          // majority of teams, so the fuzzy fallback in teamMatch.ts is only
          // needed for genuine spelling divergences now.
          location?: string;
          logos?: Array<{ href: string }>;
        };
      }>;
    }>;
  }>;
}

export interface EspnTeamLogo {
  espnId: string;
  displayName: string;
  logoUrl?: string;
}

export async function fetchEspnTeamLogos(): Promise<Map<string, EspnTeamLogo>> {
  const res = await fetch(TEAMS_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`ESPN teams fetch failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as EspnTeamsResponse;

  const bySchool = new Map<string, EspnTeamLogo>();
  for (const league of json.sports?.[0]?.leagues ?? []) {
    for (const entry of league.teams) {
      const t = entry.team;
      bySchool.set(normalize(t.location ?? t.displayName), {
        espnId: t.id,
        displayName: t.displayName,
        logoUrl: t.logos?.[0]?.href,
      });
    }
  }
  return bySchool;
}
