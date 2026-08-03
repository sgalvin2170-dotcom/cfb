// Client app is read-only. All writes happen server-side via the ETL job's
// admin SDK, which bypasses these rules entirely (see scripts/etl/*).
// Push with: npx instant-cli@latest push perms
import type { InstantRules } from '@instantdb/react-native';

const rules = {
  $default: {
    allow: {
      view: 'true',
      create: 'false',
      update: 'false',
      delete: 'false',
    },
  },
} satisfies InstantRules;

export default rules;
