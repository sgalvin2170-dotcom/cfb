// Daily ETL entrypoint. Run with: npm run etl -- [week]
// CFBD (schedule/venues/odds/talent) + ESPN FPI + Sagarin + FEI +
// TeamRankings + ThePredictionTracker + Open-Meteo weather -> v1
// equal-weight ensemble -> ATS/O-U/ML picks. Injuries still pending.
import { runCfbdVerticalSlice } from './upsertCore';
import { runRatingsIngestion } from './upsertRatings';
import { runWeatherIngestion } from './upsertWeather';
import { runRecruitingPortalIngestion } from './upsertRecruitingPortal';
import { runPollsIngestion } from './upsertPolls';
import { runEnsembleWithLogging } from './ensemble';
import { exportTodayCsv } from './csv';

async function main() {
  const weekArg = process.argv[2];
  const week = weekArg ? Number(weekArg) : undefined;

  console.log(`Starting ETL run${week ? ` for week ${week}` : ' (all weeks)'}...`);

  const cfbdResult = await runCfbdVerticalSlice(week);
  console.log('CFBD summary:', cfbdResult);

  await runRatingsIngestion();
  await runWeatherIngestion(week);
  await runRecruitingPortalIngestion();
  await runPollsIngestion(week);

  const picksComputed = await runEnsembleWithLogging(week);
  console.log('Ensemble picks computed:', picksComputed);

  await exportTodayCsv();
}

main().catch((err) => {
  console.error('ETL run failed:', err);
  process.exitCode = 1;
});
