// Daily ETL entrypoint. Run with: npm run etl -- [week]
// Phase 3: CFBD (schedule/venues/odds) + ESPN FPI + Sagarin -> v1 equal-weight
// ensemble -> ATS picks. Totals/ML and the remaining sources (FEI,
// TeamRankings, ThePredictionTracker, weather, injuries) come in later phases.
import { runCfbdVerticalSlice } from './upsertCore';
import { runRatingsIngestion } from './upsertRatings';
import { runEnsembleWithLogging } from './ensemble';
import { exportTodayCsv } from './csv';

async function main() {
  const weekArg = process.argv[2];
  const week = weekArg ? Number(weekArg) : undefined;

  console.log(`Starting ETL run${week ? ` for week ${week}` : ' (all weeks)'}...`);

  const cfbdResult = await runCfbdVerticalSlice(week);
  console.log('CFBD summary:', cfbdResult);

  await runRatingsIngestion();

  const picksComputed = await runEnsembleWithLogging(week);
  console.log('Ensemble picks computed:', picksComputed);

  await exportTodayCsv();
}

main().catch((err) => {
  console.error('ETL run failed:', err);
  process.exitCode = 1;
});
