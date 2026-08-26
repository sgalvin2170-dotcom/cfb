// Head coach ETL step: CFBD /coaches -> InstantDB `coaches`, one row per
// team holding the current head coach's tenure and win-loss record.
//
// Unlike every other CFBD-sourced step, this one costs far more than a
// couple of calls: identifying each team's current coach is one bulk call,
// but their full career (needed for record-at-school and career record) has
// no bulk form — it's one call per coach, by name. At 138 FBS teams that's
// ~139 calls per full refresh, which would blow through CFBD's 1,000
// call/month free tier if it ran on every daily ETL run. Coach identities
// and win-loss totals don't change mid-week, so this only actually refreshes
// once every REFRESH_INTERVAL_DAYS, gated by the last successful
// `scrape_runs` entry for this source — cheap every day but the one in ~7.
import { db, transactInChunks } from './instantAdmin';
import { recordRun } from './upsertCore';
import { env } from './env';
import { normalize } from './teamMatch';
import { fetchCoachCareer, fetchCoachesForSeason, type CfbdCoach, type CfbdCoachSeason } from './sources/cfbd';

const REFRESH_INTERVAL_DAYS = 7;

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

function sumRecord(seasons: CfbdCoachSeason[]) {
  return seasons.reduce(
    (acc, s) => ({
      wins: acc.wins + (s.wins ?? 0),
      losses: acc.losses + (s.losses ?? 0),
      ties: acc.ties + (s.ties ?? 0),
    }),
    { wins: 0, losses: 0, ties: 0 },
  );
}

async function recentlyRefreshed(): Promise<boolean> {
  const cutoff = new Date(Date.now() - REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
  const { scrape_runs } = await db.query({
    scrape_runs: {
      $: { where: { source: 'cfbd:coaches', status: 'ok', finishedAt: { $gte: cutoff } }, limit: 1 },
    },
  });
  return (scrape_runs as any[]).length > 0;
}

async function upsertCoaches() {
  if (await recentlyRefreshed()) {
    console.log(`[coaches] refreshed within the last ${REFRESH_INTERVAL_DAYS}d — skipping (keeps CFBD call volume down)`);
    return 0;
  }

  const bySchool = await fetchKnownTeams();
  const currentSeasonCoaches = await fetchCoachesForSeason(env.season);

  let unmatched = 0;
  const txs: any[] = [];

  for (const coach of currentSeasonCoaches) {
    const currentSeason = coach.seasons.find((s) => s.year === env.season);
    if (!currentSeason) continue;
    const match = exactMatch(currentSeason.school, bySchool);
    if (!match) {
      unmatched++;
      continue;
    }

    let career: CfbdCoach[];
    try {
      career = await fetchCoachCareer(coach.firstName, coach.lastName);
    } catch (err) {
      // Skip rather than write a row — falling back to just `currentSeason`
      // would silently store "1 year, 0-0" as this coach's tenure/record,
      // which looks like real data but isn't. Leaves any prior row (from an
      // earlier successful refresh) untouched instead of overwriting it with
      // something worse.
      console.warn(`[coaches] could not fetch career history for ${coach.firstName} ${coach.lastName}, skipping:`, err);
      continue;
    } finally {
      // Throttle: one fetchCoachCareer call per coach (~138 total) fired
      // back-to-back is exactly what tripped CFBD's burst rate limiter in
      // practice (cfbdGet retries on 429, but a small gap here means most
      // requests don't need to). Runs whether the call above succeeded or
      // failed, so a run of failures doesn't hammer the limiter even harder.
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const self = career.find((c) => c.id === coach.id) ?? career.find((c) => c.firstName === coach.firstName && c.lastName === coach.lastName);
    if (!self) {
      console.warn(`[coaches] career lookup for ${coach.firstName} ${coach.lastName} returned no matching record, skipping`);
      continue;
    }
    const seasons = self.seasons;

    const atSchool = seasons.filter((s) => s.school === currentSeason.school);
    const yearsAtSchool = new Set(atSchool.map((s) => s.year)).size;
    const schoolRecord = sumRecord(atSchool);
    const careerRecord = sumRecord(seasons);

    txs.push(
      db.tx.coaches
        .lookup('coachKey', match.id)
        .update({
          firstName: coach.firstName,
          lastName: coach.lastName,
          hireDate: coach.hireDate,
          yearsAtSchool,
          wins: schoolRecord.wins,
          losses: schoolRecord.losses,
          ties: schoolRecord.ties,
          careerWins: careerRecord.wins,
          careerLosses: careerRecord.losses,
          careerTies: careerRecord.ties,
          computedAt: new Date().toISOString(),
        })
        .link({ team: match.id }),
    );
  }

  if (unmatched > 0) {
    console.warn(`[coaches] could not match ${unmatched} team name(s) to a known FBS team`);
  }

  await transactInChunks(txs);
  return txs.length;
}

export async function runCoachesIngestion() {
  return recordRun('cfbd:coaches', upsertCoaches);
}
