# Pulse Assistant (mobile)

The Expo app (SDK 57, Expo Router, TypeScript) for the job-alert dashboard, on iOS and Android. It reads from Supabase (RLS lets only the owner read) and sends every marketplace or LLM action through the backend API.

## Run

```bash
cd apps/mobile
npm install
npx expo start            # then press i (iOS simulator) / a (Android) or scan the QR with Expo Go
npm run start:demo        # EXPO_PUBLIC_DEMO=1: fixture data from src/demo.ts, no sign-in, no backend
```

Needs Node >= 20.19.4. Config is in `.env` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY`, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_DEMO`, `EXPO_PUBLIC_EAS_PROJECT_ID`) and is mirrored into `app.config.ts` `extra`.

Sign-in uses an emailed 6-digit code (`signInWithOtp` + `verifyOtp`). For a code to arrive, the Supabase "Magic Link" email template must include `{{ .Token }}`.

## Push

Push tokens are registered on sign-in and inserted into `public.devices`. This needs a physical device and an EAS project id: run `npx eas-cli@latest init` and put the id in `EXPO_PUBLIC_EAS_PROJECT_ID`. Android push does not work in Expo Go (SDK 53+), so use a dev build (`npx expo run:android` or `eas build --profile development`). A push with `data: { jobId }` opens that job when tapped.

## Layout

- `src/app/`: routes. The tabs (`(tabs)/`) are Overview, Jobs, Proposals, Closer and More. `job/[id]`, `proposal/[id]`, `watchlist`, `insights`, `feeds`, `settings` and `sign-in` sit outside the tabs.
- `src/lib/data.ts`: Supabase reads and the only writes allowed (jobs.status, settings.data merge, feedback, devices), plus a `useQuery` hook with realtime refetch.
- `src/lib/api.ts`: the backend REST client (Bearer = Supabase access token) and the reachability banner state.
- `src/types.ts`: copied from `lib/types.ts`. **Keep in sync.**
- `src/theme.ts`: tokens mirrored from `app/globals.css`, light and dark.

Checks: `npx tsc --noEmit`, `npx expo lint`, `npx expo-doctor`.
