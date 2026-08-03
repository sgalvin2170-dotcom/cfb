// Loads .env for local runs. In GitHub Actions, secrets are already present
// as env vars, so this is a harmless no-op there (dotenv only fills gaps).
import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const env = {
  instantAppId: required('INSTANT_APP_ID'),
  instantAdminToken: required('INSTANT_APP_ADMIN_TOKEN'),
  cfbdApiKey: required('CFBD_API_KEY'),
  season: Number(process.env.CFB_SEASON ?? new Date().getFullYear()),
};
