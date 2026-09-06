// Daily ETL entrypoint. Run with: npm run etl -- [week]
// CFBD (schedule/venues/odds/talent) + ESPN FPI + Sagarin + FEI +
// TeamRankings + ThePredictionTracker + Open-Meteo weather -> v1
// equal-weight ensemble -> ATS/O-U/ML picks. Injuries still pending.
import { runCfbdVerticalSlice } from './upsertCore';
import { runGameTeamStatsIngestion } from './upsertGameTeamStats';
import { runRatingsIngestion } from './upsertRatings';
import { runWeatherIngestion } from './upsertWeather';
import { runRecruitingPortalIngestion } from './upsertRecruitingPortal';
import { runPreseasonScoresIngestion } from './upsertPreseasonScores';
import { runCoachesIngestion } from './upsertCoaches';
import { runPollsIngestion } from './upsertPolls';
import { runEnsembleWithLogging } from './ensemble';
import { exportTodayCsv } from './csv';

// Each of these steps is independent of the others, so one step's total
// failure shouldn't cost the rest of the day's data — and especially
// shouldn't cost the ensemble/freeze step below it, which is what actually
// produces and freezes picks. Discovered 2026-09-05: a Sagarin page-format
// change threw uncaught out of runRatingsIngestion, which stopped main()
// cold — weather, recruiting, preseason scores, coaches, polls, and 5
// straight days of ensemble/Monte-Carlo/Best-Bets freezing plus the CSV
// export never ran, all because of one unrelated scraper. This is the
// step-level twin of recordRunTolerant (upsertCore.ts), which handles the
// same problem one level down, between individual sources within a step.
async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[etl] step "${name}" failed — continuing with the rest of the run:`, err);
  }
}

async function main() {
  const weekArg = process.argv[2];
  const week = weekArg ? Number(weekArg) : undefined;

  console.log(`Starting ETL run${week ? ` for week ${week}` : ' (all weeks)'}...`);

  // Everything downstream links against teams/games/venues this writes, so
  // unlike the steps below, a failure here is genuinely fatal.
  const cfbdResult = await runCfbdVerticalSlice(week);
  console.log('CFBD summary:', cfbdResult);

  await step('game-team-stats', runGameTeamStatsIngestion);
  await step('ratings', runRatingsIngestion);
  await step('weather', () => runWeatherIngestion(week));
  await step('recruiting-portal', runRecruitingPortalIngestion);
  await step('preseason-scores', runPreseasonScoresIngestion);
  await step('coaches', runCoachesIngestion);
  await step('polls', () => runPollsIngestion(week));

  const picksComputed = await runEnsembleWithLogging(week);
  console.log('Ensemble picks computed:', picksComputed);

  await exportTodayCsv();
}

main().catch((err) => {
  console.error('ETL run failed:', err);
  process.exitCode = 1;
});
