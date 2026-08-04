// Open-Meteo forecast API — free, no key, but only forecasts ~16 days out
// (confirmed against the live API: requesting a date beyond that range
// returns an explicit `{error: true}`, not empty data). Most ETL runs will
// be too far ahead of kickoff for this to return anything for a given game
// — that's expected, not a bug; a "gameday refresh" run closer to kickoff
// (per the plan's two-cron design) is what actually populates this.
const FORECAST_WINDOW_DAYS = 15;

export interface WeatherAtKickoff {
  tempF?: number;
  windMph?: number;
  windDir?: string;
  precipProb?: number;
}

const COMPASS_DIRS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
]; // prettier-ignore

function degreesToCompass(deg: number): string {
  return COMPASS_DIRS[Math.round(deg / 22.5) % 16];
}

export function withinForecastWindow(kickoff: Date, now: Date = new Date()): boolean {
  const daysUntil = (kickoff.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return daysUntil >= 0 && daysUntil <= FORECAST_WINDOW_DAYS;
}

export async function fetchWeatherAtKickoff(
  lat: number,
  lng: number,
  kickoff: Date,
): Promise<WeatherAtKickoff | undefined> {
  const dateStr = kickoff.toISOString().slice(0, 10);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('hourly', 'temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('start_date', dateStr);
  url.searchParams.set('end_date', dateStr);

  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    return undefined; // out of forecast range, or a transient API issue — skip this game
  }

  const times: string[] = json.hourly.time;
  const kickoffMs = kickoff.getTime();
  let closestIdx = 0;
  let closestDelta = Infinity;
  for (let i = 0; i < times.length; i++) {
    const delta = Math.abs(new Date(times[i] + 'Z').getTime() - kickoffMs);
    if (delta < closestDelta) {
      closestDelta = delta;
      closestIdx = i;
    }
  }

  const windDeg = json.hourly.wind_direction_10m?.[closestIdx];
  return {
    tempF: json.hourly.temperature_2m?.[closestIdx],
    windMph: json.hourly.wind_speed_10m?.[closestIdx],
    windDir: windDeg != null ? degreesToCompass(windDeg) : undefined,
    precipProb: json.hourly.precipitation_probability?.[closestIdx],
  };
}
