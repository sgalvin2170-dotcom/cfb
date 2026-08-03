import 'react-native-get-random-values';
import { init } from '@instantdb/react-native';
import Constants from 'expo-constants';

import schema from '../instant.schema';

const appId =
  process.env.EXPO_PUBLIC_INSTANT_APP_ID ??
  (Constants.expoConfig?.extra?.instantAppId as string | undefined);

if (!appId) {
  throw new Error(
    'Missing EXPO_PUBLIC_INSTANT_APP_ID. Copy .env.example to .env and set your InstantDB app ID from https://instantdb.com/dash',
  );
}

export const db = init({ appId, schema });
