// Recruiting/portal ETL step: CFBD recruiting + transfer portal + roster ->
// InstantDB `recruiting_classes` / `portal_transfers` / `roster_continuity`.
// Needs teams already upserted. Unlike the other free-text-team-named
// sources, this matches by EXACT normalized name (not teamMatch.ts's fuzzy
// findBestMatch): CFBD is the provider for both our /teams/fbs roster and
// these endpoints, so a genuine FBS match is always exact. That matters
// because these endpoints — unlike ratings sources — also include non-FBS
// schools (e.g. "Alabama A&M", "Alabama State"), and fuzzy prefix matching
// silently mismatched those onto our real "Alabama" (word-prefix logic
// treats "Alabama" as a valid prefix of "Alabama A&M"), overwriting its
// correct recruiting row. Exact match correctly matches every real FBS name
// and correctly skips the non-FBS ones instead of guessing.
import { db, transactInChunks } from './instantAdmin';
import { recordRun } from './upsertCore';
import { normalize } from './teamMatch';
import { env } from './env';
import {
  fetchRecruitingPlayers,
  fetchRecruitingTeams,
  fetchRoster,
  fetchTransferPortal,
  type CfbdPortalEntry,
  type CfbdRosterPlayer,
} from './sources/cfbd';

interface KnownTeam {
  id: string;
}

async function fetchKnownTeams(): Promise<Map<string, KnownTeam>> {
  const { teams } = await db.query({ teams: {} });
  const bySchool = new Map<string, KnownTeam>();
  for (const t of teams as any[]) bySchool.set(normalize(t.school), { id: t.id });
  return bySchool;
}

function exactMatch(name: string | undefined, bySchool: Map<string, KnownTeam>): KnownTeam | undefined {
  return name ? bySchool.get(normalize(name)) : undefined;
}

// CFBD's position codes across /roster and /player/portal (confirmed by
// sampling both endpoints directly — not from docs, which don't enumerate
// them). Kickers/punters/long-snappers/return specialists/ATH are excluded
// from both groups rather than guessed at.
const OFFENSE_POSITIONS = new Set(['QB', 'RB', 'FB', 'WR', 'TE', 'OL', 'OT', 'OG', 'G', 'C', 'IOL']);
const DEFENSE_POSITIONS = new Set(['DB', 'DL', 'DT', 'DE', 'EDGE', 'LB', 'CB', 'S', 'NT', 'IDL']);

// CFBD's own ingest of the 247Sports Composite team rankings (rank/points
// match the live 247Sports page exactly) plus a star-count rollup from the
// per-player endpoint, which the team-rankings endpoint doesn't include.
async function upsertRecruitingClasses(bySchool: Map<string, KnownTeam>) {
  const [teamsRanked, players] = await Promise.all([
    fetchRecruitingTeams(env.season),
    fetchRecruitingPlayers(env.season),
  ]);

  const starsByTeam = new Map<string, { five: number; four: number; three: number; two: number; total: number }>();
  for (const p of players) {
    if (!p.committedTo) continue;
    const bucket = starsByTeam.get(p.committedTo) ?? { five: 0, four: 0, three: 0, two: 0, total: 0 };
    if (p.stars === 5) bucket.five++;
    else if (p.stars === 4) bucket.four++;
    else if (p.stars === 3) bucket.three++;
    else if (p.stars === 2) bucket.two++;
    bucket.total++;
    starsByTeam.set(p.committedTo, bucket);
  }

  let unmatched = 0;
  const txs = teamsRanked.flatMap((row) => {
    const match = exactMatch(row.team, bySchool);
    if (!match) {
      unmatched++;
      return [];
    }
    const stars = starsByTeam.get(row.team) ?? { five: 0, four: 0, three: 0, two: 0, total: 0 };
    return [
      db.tx.recruiting_classes
        .lookup('recruitKey', `${match.id}:${env.season}`)
        .update({
          season: env.season,
          rank: row.rank,
          points: row.points,
          fiveStars: stars.five,
          fourStars: stars.four,
          threeStars: stars.three,
          twoStars: stars.two,
          commitCount: stars.total,
        })
        .link({ team: match.id }),
    ];
  });

  if (unmatched > 0) {
    console.warn(`[recruiting] could not match ${unmatched} team name(s) to a known FBS team`);
  }

  await transactInChunks(txs);
  return txs.length;
}

// Leaguewide rank by CFBD's composite `rating` among all rated entries this
// season, used as a stand-in for "top 100 portal players" — there's no
// scrapable per-team top-100 list (ESPN's is a hand-curated article behind a
// bot challenge, not structured per-team data).
function rankByRating(entries: CfbdPortalEntry[]): Map<CfbdPortalEntry, number> {
  const rated = entries
    .filter((e) => e.rating != null)
    .sort((a, b) => (b.rating as number) - (a.rating as number));
  const ranks = new Map<CfbdPortalEntry, number>();
  rated.forEach((e, i) => ranks.set(e, i + 1));
  return ranks;
}

async function upsertPortalTransfers(bySchool: Map<string, KnownTeam>) {
  const entries = await fetchTransferPortal(env.season);
  const ranks = rankByRating(entries);

  const txs = entries.map((entry) => {
    const portalRank = ranks.get(entry);
    const origin = exactMatch(entry.origin, bySchool);
    const destination = exactMatch(entry.destination, bySchool);
    const key = `${entry.season}:${entry.firstName}:${entry.lastName}:${entry.origin ?? ''}:${entry.destination ?? ''}:${entry.transferDate}`;

    return db.tx.portal_transfers
      .lookup('transferKey', key)
      .update({
        season: entry.season,
        firstName: entry.firstName,
        lastName: entry.lastName,
        position: entry.position,
        originName: entry.origin,
        destinationName: entry.destination,
        transferDate: entry.transferDate,
        rating: entry.rating,
        stars: entry.stars,
        eligibility: entry.eligibility,
        portalRank,
        topPortalPlayer: portalRank != null && portalRank <= 100,
      })
      .link({
        ...(origin ? { originTeam: origin.id } : {}),
        ...(destination ? { destinationTeam: destination.id } : {}),
      });
  });

  await transactInChunks(txs);
  return txs.length;
}

// Not literally "returning starters" — CFBD has no starter/snap-count
// designation — this counts whole-roster continuity (player id present on
// both this season's and last season's roster for the same team), split by
// offense/defense position group. Skips gracefully (0 rows) until CFBD
// publishes the current season's roster, same as /talent.
async function upsertRosterContinuity(bySchool: Map<string, KnownTeam>) {
  const [current, prior] = await Promise.all([
    fetchRoster(env.season),
    fetchRoster(env.season - 1),
  ]);

  if (current.length === 0) {
    console.log(`[roster-continuity] CFBD has not published the ${env.season} roster yet — skipping`);
    return 0;
  }

  const priorIdsByTeam = new Map<string, Set<string>>();
  for (const p of prior) {
    if (!priorIdsByTeam.has(p.team)) priorIdsByTeam.set(p.team, new Set());
    priorIdsByTeam.get(p.team)!.add(p.id);
  }

  const currentByTeam = new Map<string, CfbdRosterPlayer[]>();
  for (const p of current) {
    if (!currentByTeam.has(p.team)) currentByTeam.set(p.team, []);
    currentByTeam.get(p.team)!.push(p);
  }

  const now = new Date().toISOString();
  let unmatched = 0;
  const txs = Array.from(currentByTeam.entries()).flatMap(([teamName, roster]) => {
    const match = exactMatch(teamName, bySchool);
    if (!match) {
      unmatched++;
      return [];
    }
    const priorIds = priorIdsByTeam.get(teamName) ?? new Set<string>();
    const returning = roster.filter((p) => priorIds.has(p.id));
    const offenseReturning = returning.filter((p) => p.position && OFFENSE_POSITIONS.has(p.position)).length;
    const defenseReturning = returning.filter((p) => p.position && DEFENSE_POSITIONS.has(p.position)).length;

    return [
      db.tx.roster_continuity
        .lookup('continuityKey', `${match.id}:${env.season}`)
        .update({ season: env.season, offenseReturning, defenseReturning, computedAt: now })
        .link({ team: match.id }),
    ];
  });

  if (unmatched > 0) {
    console.warn(`[roster-continuity] could not match ${unmatched} team name(s) to a known FBS team`);
  }

  await transactInChunks(txs);
  return txs.length;
}

export async function runRecruitingPortalIngestion() {
  const bySchool = await fetchKnownTeams();

  await recordRun('cfbd:recruiting', () => upsertRecruitingClasses(bySchool));
  await recordRun('cfbd:portal', () => upsertPortalTransfers(bySchool));
  await recordRun('cfbd:roster-continuity', () => upsertRosterContinuity(bySchool));
}
