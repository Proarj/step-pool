# StepPool App Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the StepPool mobile app (Expo, iOS + Android) on top of the
deployed Supabase backend. It covers Google sign-in, groups, automatic step sync
from Apple Health / Health Connect, a live "today" screen, history with a
leaderboard, local reminders, and local release builds for both platforms.

**Architecture:** One Expo SDK 57 codebase (expo-router, TypeScript). All game
rules live on the server (Plan 1). The app reads tables through RLS and writes
only through the RPCs. Pure logic (IST time, the "if the day ended now" preview,
leaderboard, sync retry, auth-callback parsing, entitlement stripping) is
unit-tested with Vitest. Platform glue (health, notifications, background
task, screens) is type-checked and verified by prebuild output and builds.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / React 19.2, expo-router,
@supabase/supabase-js 2.x, @react-native-async-storage/async-storage,
@kingstinct/react-native-healthkit 16.1 (+ react-native-nitro-modules),
react-native-health-connect 4.1 (its Expo plugin is built in; **do not**
install the deprecated `expo-health-connect`), expo-build-properties,
expo-background-task + expo-task-manager, expo-notifications, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-10-steppool-design.md`
**Backend contract (Plan 1, live on Supabase):** `supabase/migrations/*.sql`

## Global Constraints

- Every shell command runs from `~/Desktop/step-pool` after `source ~/.nvm/nvm.sh && nvm use >/dev/null`.
- IST everywhere: the app computes "today" with `istToday()`, never from the phone's own time zone.
- The app writes only through the RPCs `create_group`, `join_group`, `update_group_settings`, `leave_group`, `upload_steps(p_day, p_steps, p_source)`. Step sources are exactly `apple_health` and `health_connect`.
- iOS builds must work with a **free** Apple account. No `aps-environment` (push) entitlement, no HealthKit background-delivery entitlement, no Sign in with Apple.
- The Supabase URL and publishable key come from `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`.env.local`, git-ignored). The secret key never appears anywhere in the app.
- iOS bundle id comes from env `IOS_BUNDLE_ID` (default `com.steppool.app`). Android package: `com.steppool.app`.
- Reminders: daily 23:30 local ("Sync before midnight"). iOS only: buildTime + 6 days ("Re-run StepPool from Xcode today").
- Hand-entered steps are excluded on iOS in release builds only (dev builds include them, so the Simulator's Health app can be used for testing). On Android, Health Connect's aggregate can't exclude them without losing de-duplication, so Android falls back to trust (spec §5).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nothing is pushed to any git remote.

## Review Focus

1. **The phone's time zone is not IST** (a friend travelling): the app still reads and uploads the IST day. `istToday`/`istDayBounds` tests use explicit UTC instants. *(Task 2)*
2. **A sync that crosses midnight**: the server rejects yesterday, and the app uploads the new day once instead of showing an error. *(Task 3)*
3. **The push entitlement sneaking back into the iOS build** (expo-notifications auto-applies its plugin): stripped at the finalized stage and checked in the prebuilt `.entitlements`. *(Task 1)*
4. **A background run while signed out or before step access is granted**: the background task returns quietly, without crashing or uploading. *(Task 5)*
5. **An iPhone where step access was denied** (HealthKit never reveals read denial, so syncs return 0): the setup screen explains how to turn Steps on. *(Task 6)*

---

### Task 1: Native dependencies, app config, and the free-account entitlement guard

**Files:**
- Create: `app.config.ts`, `plugins/strip-push-entitlement.js`, `plugins/without-push-entitlement.js`, `plugins/strip-push-entitlement.test.ts`
- Delete: `app.json`
- Modify: `package.json` (dependencies), `vitest.config.mts` (include `plugins/**/*.test.ts`)

**Interfaces:**
- Produces: `stripPushEntitlement(xml: string): string` (CommonJS export of `plugins/strip-push-entitlement.js`), the config plugin `./plugins/without-push-entitlement`, and `Constants.expoConfig.extra.buildTime: string` (ISO time the app was configured/built).

- [ ] **Step 1: Install the native dependencies (SDK-matched versions)**

```bash
cd ~/Desktop/step-pool && source ~/.nvm/nvm.sh && nvm use >/dev/null
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill \
  @kingstinct/react-native-healthkit react-native-nitro-modules react-native-health-connect \
  expo-build-properties expo-background-task expo-task-manager expo-notifications
npm uninstall @expo/ui expo-glass-effect expo-symbols expo-image expo-device
```
Expected: exit 0. `npm ls expo-health-connect` prints `(empty)`.

- [ ] **Step 2: Write the failing test for the entitlement stripper**

`plugins/strip-push-entitlement.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stripPushEntitlement } = require('./strip-push-entitlement.js') as {
  stripPushEntitlement(xml: string): string;
};

const withPush = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>aps-environment</key>
  <string>development</string>
  <key>com.apple.developer.healthkit</key>
  <true/>
</dict>
</plist>`;

describe('stripPushEntitlement', () => {
  it('removes aps-environment and keeps everything else', () => {
    const out = stripPushEntitlement(withPush);
    expect(out).not.toContain('aps-environment');
    expect(out).toContain('<key>com.apple.developer.healthkit</key>');
    expect(out).toContain('<true/>');
  });

  it('leaves a file without push untouched', () => {
    const clean = withPush.replace(/\s*<key>aps-environment<\/key>\s*<string>development<\/string>/, '');
    expect(stripPushEntitlement(clean)).toBe(clean);
  });
});
```

In `vitest.config.mts`, change the `include` line to:
```ts
    include: ['supabase/tests/**/*.test.ts', 'src/**/*.test.ts', 'plugins/**/*.test.ts'],
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run plugins`
Expected: FAIL, `Cannot find module './strip-push-entitlement.js'`.

- [ ] **Step 4: Write the stripper and the config plugin**

`plugins/strip-push-entitlement.js`:
```js
// Removes the Push Notifications entitlement from an .entitlements plist.
// Free Apple developer accounts cannot sign apps that carry it.
function stripPushEntitlement(xml) {
  return xml.replace(/\s*<key>aps-environment<\/key>\s*<string>[^<]*<\/string>/g, '');
}

module.exports = { stripPushEntitlement };
```

`plugins/without-push-entitlement.js`:
```js
// expo-notifications always adds the aps-environment (push) entitlement, and
// Expo applies its plugin automatically once the package is installed.
// StepPool only schedules local reminders, so after every other plugin has
// run, strip the entitlement so free Apple accounts can sign the app.
const fs = require('fs');
const { IOSConfig, withFinalizedMod } = require('expo/config-plugins');
const { stripPushEntitlement } = require('./strip-push-entitlement');

module.exports = function withoutPushEntitlement(config) {
  return withFinalizedMod(config, [
    'ios',
    async (config) => {
      const file = IOSConfig.Entitlements.getEntitlementsPath(config.modRequest.projectRoot);
      if (file && fs.existsSync(file)) {
        const xml = fs.readFileSync(file, 'utf8');
        const stripped = stripPushEntitlement(xml);
        if (stripped !== xml) fs.writeFileSync(file, stripped);
      }
      return config;
    },
  ]);
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run plugins`
Expected: 2 tests PASS.

- [ ] **Step 6: Replace app.json with app.config.ts**

Delete `app.json`, then create `app.config.ts`:
```ts
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Each free Apple account needs its own bundle id: IOS_BUNDLE_ID=com.<name>.steppool
const IOS_BUNDLE_ID = process.env.IOS_BUNDLE_ID ?? 'com.steppool.app';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'StepPool',
  slug: 'step-pool',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'steppool',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: IOS_BUNDLE_ID,
    icon: './assets/expo.icon',
  },
  android: {
    package: 'com.steppool.app',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.health.READ_STEPS',
      'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND',
    ],
  },
  web: { output: 'static', favicon: './assets/images/favicon.png' },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      { backgroundColor: '#208AEF', image: './assets/images/splash-icon.png', imageWidth: 76 },
    ],
    [
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription: 'StepPool reads your step count to check your daily goal.',
        NSHealthUpdateUsageDescription: false,
        background: false,
      },
    ],
    'react-native-health-connect',
    [
      'expo-build-properties',
      { android: { compileSdkVersion: 36, targetSdkVersion: 36, minSdkVersion: 26 } },
    ],
    'expo-background-task',
    'expo-notifications',
    './plugins/without-push-entitlement',
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: { buildTime: new Date().toISOString() },
});
```

- [ ] **Step 7: Prebuild both platforms and check the generated native config**

```bash
cd ~/Desktop/step-pool && source ~/.nvm/nvm.sh && nvm use >/dev/null
mkdir -p .superpowers/logs
npx expo prebuild --clean --no-install > .superpowers/logs/prebuild.log 2>&1; tail -5 .superpowers/logs/prebuild.log
cat ios/StepPool/StepPool.entitlements
grep -E 'health\.READ_STEPS|READ_HEALTH_DATA_IN_BACKGROUND|VIEW_PERMISSION_USAGE|ACTION_SHOW_PERMISSIONS_RATIONALE' android/app/src/main/AndroidManifest.xml
grep -A3 NSHealthShareUsageDescription ios/StepPool/Info.plist
```
Expected:
- The entitlements contain `com.apple.developer.healthkit`, and do **not** contain `aps-environment` or `com.apple.developer.healthkit.background-delivery`.
- The Android manifest lists both health permissions and the permission-rationale intent filter / activity alias.
- Info.plist has the share usage description.

`ios/` and `android/` are git-ignored, because they are regenerated by prebuild.

- [ ] **Step 8: Run the full verification and commit**

Run: `npm test && npm run typecheck`
Expected: all tests pass (55 SQL + 2 plugin); tsc exits 0.

```bash
git add -A
git commit -m "Add native deps, app.config.ts and the free-account push entitlement guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: IST time, formatting, preview and leaderboard (pure logic)

**Files:**
- Create: `src/lib/time.ts`, `src/lib/format.ts`, `src/lib/preview.ts`, `src/lib/leaderboard.ts`
- Test: `src/lib/time.test.ts`, `src/lib/format.test.ts`, `src/lib/preview.test.ts`, `src/lib/leaderboard.test.ts`

**Interfaces:**
- Produces:
  - `istToday(now?: Date): string` ("YYYY-MM-DD"), `istDayBounds(day: string): { start: Date; end: Date }`, `msUntilIstMidnight(now?: Date): number`, `addDays(day: string, n: number): string`
  - `formatCountdown(ms: number): string`, `formatAgo(iso: string, now: Date): string`, `formatDay(day: string): string`, `formatCoins(n: number): string`
  - `type PreviewMember = { userId: string; steps: number; balance: number }`, `previewDay(goal: number, stake: number, members: PreviewMember[]): Record<string, number>`
  - `type DayResult = { day: string; userId: string; steps: number; hit: boolean; coinsChange: number }`, `type LeaderboardRow = { userId: string; net: number; daysHit: number; daysPlayed: number; streak: number }`, `buildLeaderboard(results: DayResult[]): LeaderboardRow[]`, `groupByDay<T extends { day: string }>(rows: T[]): { day: string; rows: T[] }[]`

- [ ] **Step 1: Write the failing tests**

`src/lib/time.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { addDays, istDayBounds, istToday, msUntilIstMidnight } from './time';

describe('IST time', () => {
  it('istToday follows IST whatever the device time zone', () => {
    expect(istToday(new Date('2026-10-11T18:29:59Z'))).toBe('2026-10-11'); // 23:59:59 IST
    expect(istToday(new Date('2026-10-11T18:30:00Z'))).toBe('2026-10-12'); // 00:00 IST
  });

  it('istDayBounds gives the instants of IST midnight and the next one', () => {
    expect(istDayBounds('2026-10-11')).toEqual({
      start: new Date('2026-10-10T18:30:00Z'),
      end: new Date('2026-10-11T18:30:00Z'),
    });
  });

  it('msUntilIstMidnight counts down to 12:00 AM IST', () => {
    expect(msUntilIstMidnight(new Date('2026-10-11T17:30:00Z'))).toBe(60 * 60 * 1000); // 23:00 IST
  });

  it('addDays crosses month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });
});
```

`src/lib/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatAgo, formatCoins, formatCountdown, formatDay } from './format';

describe('format', () => {
  it.each<[number, string]>([
    [3 * 3600_000 + 5 * 60_000, '3h 5m'],
    [45 * 60_000, '45m'],
    [59_000, 'under a minute'],
  ])('formatCountdown(%i) = %s', (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });

  it('formatAgo says how long since a sync', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    expect(formatAgo('2026-10-11T11:59:30Z', now)).toBe('just now');
    expect(formatAgo('2026-10-11T11:48:00Z', now)).toBe('12 min ago');
    expect(formatAgo('2026-10-11T09:00:00Z', now)).toBe('3 h ago');
  });

  it('formatDay shows weekday, day and month', () => {
    expect(formatDay('2026-10-11')).toBe('Sun 11 Oct');
  });

  it('formatCoins signs gains and losses', () => {
    expect(formatCoins(30)).toBe('+30');
    expect(formatCoins(-30)).toBe('−30');
    expect(formatCoins(0)).toBe('0');
  });
});
```

`src/lib/preview.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { previewDay } from './preview';

const m = (userId: string, steps: number, balance = 1000) => ({ userId, steps, balance });

describe('previewDay (mirrors score_group_day)', () => {
  it("moves each loser's stake to the winners in equal shares", () => {
    expect(previewDay(10000, 30, [m('you', 12400), m('a', 10050), m('b', 9800), m('c', 4000)]))
      .toEqual({ you: 30, a: 30, b: -30, c: -30 });
  });

  it('drops the remainder', () => {
    expect(previewDay(10000, 50, [m('you', 11000), m('a', 11000), m('b', 11000), m('c', 2000)]))
      .toEqual({ you: 16, a: 16, b: 16, c: -50 });
  });

  it('moves nothing when everyone or nobody missed', () => {
    expect(previewDay(10000, 30, [m('a', 1), m('b', 2)])).toEqual({ a: 0, b: 0 });
    expect(previewDay(10000, 30, [m('a', 10000), m('b', 20000)])).toEqual({ a: 0, b: 0 });
  });

  it('caps a loss at the balance', () => {
    expect(previewDay(10000, 30, [m('a', 11000), m('b', 11000), m('c', 11000), m('poor', 0, 20)]))
      .toEqual({ a: 6, b: 6, c: 6, poor: -20 });
  });
});
```

`src/lib/leaderboard.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildLeaderboard, groupByDay, type DayResult } from './leaderboard';

const r = (day: string, userId: string, hit: boolean, coinsChange: number): DayResult =>
  ({ day, userId, steps: hit ? 12000 : 3000, hit, coinsChange });

const history: DayResult[] = [
  r('2026-10-11', 'asha', true, 30), r('2026-10-11', 'ben', false, -30),
  r('2026-10-12', 'asha', false, -30), r('2026-10-12', 'ben', true, 30),
  r('2026-10-13', 'asha', true, 15), r('2026-10-13', 'ben', true, 15), r('2026-10-13', 'cara', false, -30),
];

describe('buildLeaderboard', () => {
  it('totals coins and hit days, best net first, with the current streak', () => {
    expect(buildLeaderboard(history)).toEqual([
      { userId: 'ben', net: 15, daysHit: 2, daysPlayed: 3, streak: 2 },
      { userId: 'asha', net: 15, daysHit: 2, daysPlayed: 3, streak: 1 },
      { userId: 'cara', net: -30, daysHit: 0, daysPlayed: 1, streak: 0 },
    ]);
  });

  it('is empty with no history', () => {
    expect(buildLeaderboard([])).toEqual([]);
  });
});

describe('groupByDay', () => {
  it('groups rows newest day first, keeping row order', () => {
    const days = groupByDay(history);
    expect(days.map((d) => d.day)).toEqual(['2026-10-13', '2026-10-12', '2026-10-11']);
    expect(days[0].rows.map((x) => x.userId)).toEqual(['asha', 'ben', 'cara']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib`
Expected: FAIL, modules `./time`, `./format`, `./preview`, `./leaderboard` not found.

- [ ] **Step 3: Write the implementations**

`src/lib/time.ts`:
```ts
// StepPool runs on IST for everyone (spec §3), whatever the phone's time zone.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The IST calendar date ("YYYY-MM-DD") at instant `now`. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** When an IST calendar day starts and ends (end = the next 12:00 AM IST). */
export function istDayBounds(day: string): { start: Date; end: Date } {
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function msUntilIstMidnight(now: Date = new Date()): number {
  return istDayBounds(istToday(now)).end.getTime() - now.getTime();
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
```

`src/lib/format.ts`:
```ts
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatCountdown(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatAgo(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

/** "2026-10-11" → "Sun 11 Oct". */
export function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function formatCoins(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}
```

`src/lib/preview.ts`:
```ts
export type PreviewMember = { userId: string; steps: number; balance: number };

/**
 * Coins each member would gain (+) or lose (−) if the day ended now. Mirrors
 * public.score_group_day (spec §3), except the top-up, which is not a result.
 */
export function previewDay(goal: number, stake: number, members: PreviewMember[]): Record<string, number> {
  const result: Record<string, number> = Object.fromEntries(members.map((m) => [m.userId, 0]));
  const winners = members.filter((m) => m.steps >= goal);
  const losers = members.filter((m) => m.steps < goal);
  if (winners.length === 0 || losers.length === 0) return result;

  let pot = 0;
  for (const m of losers) {
    const loss = Math.max(0, Math.min(stake, m.balance));
    result[m.userId] = loss > 0 ? -loss : 0;
    pot += loss;
  }
  const share = Math.floor(pot / winners.length);
  for (const m of winners) result[m.userId] = share;
  return result;
}
```

`src/lib/leaderboard.ts`:
```ts
export type DayResult = { day: string; userId: string; steps: number; hit: boolean; coinsChange: number };
export type LeaderboardRow = { userId: string; net: number; daysHit: number; daysPlayed: number; streak: number };

/** Totals per person, best net first. streak = hit days in a row, ending at their latest scored day. */
export function buildLeaderboard(results: DayResult[]): LeaderboardRow[] {
  const byUser = new Map<string, DayResult[]>();
  for (const r of results) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);

  const rows = [...byUser.entries()].map(([userId, rs]) => {
    const newestFirst = [...rs].sort((a, b) => b.day.localeCompare(a.day));
    const firstMiss = newestFirst.findIndex((r) => !r.hit);
    return {
      userId,
      net: rs.reduce((sum, r) => sum + r.coinsChange, 0),
      daysHit: rs.filter((r) => r.hit).length,
      daysPlayed: rs.length,
      streak: firstMiss === -1 ? newestFirst.length : firstMiss,
    };
  });
  return rows.sort((a, b) => b.net - a.net || b.streak - a.streak || a.userId.localeCompare(b.userId));
}

export function groupByDay<T extends { day: string }>(rows: T[]): { day: string; rows: T[] }[] {
  const days = new Map<string, T[]>();
  for (const row of rows) days.set(row.day, [...(days.get(row.day) ?? []), row]);
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, dayRows]) => ({ day, rows: dayRows }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib
git commit -m "Add IST time, formatting, day preview and leaderboard logic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sync core, auth-callback parsing, reminder dates (pure logic)

**Files:**
- Create: `src/lib/sync-core.ts`, `src/lib/auth-callback.ts`, `src/lib/reminder-dates.ts`
- Test: `src/lib/sync-core.test.ts`, `src/lib/auth-callback.test.ts`, `src/lib/reminder-dates.test.ts`

**Interfaces:**
- Consumes: `istToday`, `istDayBounds` (Task 2).
- Produces:
  - `type SyncDeps = { now(): Date; readSteps(start: Date, end: Date): Promise<number>; upload(day: string, steps: number): Promise<void> }`
  - `type SyncResult = { day: string; steps: number }`, `syncToday(deps: SyncDeps): Promise<SyncResult>`, `isClosedDayError(error: unknown): boolean`
  - `parseAuthCallback(url: string): { code: string } | { error: string }`
  - `expiryReminderDate(buildTimeIso: string): Date | null` (buildTime + 6 days)

- [ ] **Step 1: Write the failing tests**

`src/lib/sync-core.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isClosedDayError, syncToday, type SyncDeps } from './sync-core';

function fakes(nows: Date[], steps: number, uploadErrors: (Error | null)[] = []) {
  const reads: [Date, Date][] = [];
  const uploads: [string, number][] = [];
  let i = 0;
  let u = 0;
  const deps: SyncDeps = {
    now: () => nows[Math.min(i++, nows.length - 1)],
    readSteps: async (start, end) => { reads.push([start, end]); return steps; },
    upload: async (day, n) => {
      const error = uploadErrors[u++];
      if (error) throw error;
      uploads.push([day, n]);
    },
  };
  return { deps, reads, uploads };
}

describe('syncToday', () => {
  it("uploads today's IST total, read from 12:00 AM IST to now", async () => {
    const now = new Date('2026-10-11T15:00:00Z'); // 20:30 IST
    const { deps, reads, uploads } = fakes([now], 8421.6);
    expect(await syncToday(deps)).toEqual({ day: '2026-10-11', steps: 8422 });
    expect(reads).toEqual([[new Date('2026-10-10T18:30:00Z'), now]]);
    expect(uploads).toEqual([['2026-10-11', 8422]]);
  });

  it('moves on to the new day when midnight passes during a sync', async () => {
    const before = new Date('2026-10-11T18:29:59Z');
    const after = new Date('2026-10-11T18:30:01Z');
    const closed = new Error('Steps can only be uploaded for today (2026-10-12)');
    const { deps, uploads } = fakes([before, after], 40, [closed]);
    expect(await syncToday(deps)).toEqual({ day: '2026-10-12', steps: 40 });
    expect(uploads).toEqual([['2026-10-12', 40]]);
  });

  it('passes other errors through', async () => {
    const { deps } = fakes([new Date('2026-10-11T10:00:00Z')], 10, [new Error('Network request failed')]);
    await expect(syncToday(deps)).rejects.toThrow('Network request failed');
  });

  it('keeps steps within 0–100,000', async () => {
    const { deps, uploads } = fakes([new Date('2026-10-11T10:00:00Z')], 250000);
    await syncToday(deps);
    expect(uploads).toEqual([['2026-10-11', 100000]]);
  });

  it('recognises only the closed-day rejection', () => {
    expect(isClosedDayError(new Error('Steps can only be uploaded for today (2026-10-12)'))).toBe(true);
    expect(isClosedDayError(new Error('Steps must be between 0 and 100000'))).toBe(false);
    expect(isClosedDayError('Steps can only be uploaded for today')).toBe(false);
  });
});
```

`src/lib/auth-callback.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseAuthCallback } from './auth-callback';

describe('parseAuthCallback', () => {
  it('reads the PKCE code', () => {
    expect(parseAuthCallback('steppool://auth-callback?code=abc123')).toEqual({ code: 'abc123' });
  });

  it('reads an error from the query or the fragment', () => {
    expect(parseAuthCallback('steppool://auth-callback?error=access_denied&error_description=User+denied+access'))
      .toEqual({ error: 'User denied access' });
    expect(parseAuthCallback('steppool://auth-callback#error=server_error'))
      .toEqual({ error: 'server_error' });
  });

  it('treats a bare redirect as cancelled', () => {
    expect(parseAuthCallback('steppool://auth-callback')).toEqual({ error: 'Sign-in was cancelled' });
  });
});
```

`src/lib/reminder-dates.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { expiryReminderDate } from './reminder-dates';

describe('expiryReminderDate', () => {
  it('is six days after the build, the day before a free iOS build expires', () => {
    expect(expiryReminderDate('2026-10-11T09:00:00.000Z')).toEqual(new Date('2026-10-17T09:00:00.000Z'));
  });

  it('is null for a missing or broken build time', () => {
    expect(expiryReminderDate('not a date')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib`
Expected: the three new files FAIL with "module not found". The Task 2 files still pass.

- [ ] **Step 3: Write the implementations**

`src/lib/sync-core.ts`:
```ts
import { istDayBounds, istToday } from './time';

export type SyncResult = { day: string; steps: number };
export type SyncDeps = {
  now(): Date;
  readSteps(start: Date, end: Date): Promise<number>;
  upload(day: string, steps: number): Promise<void>;
};

const MAX_STEPS = 100_000;

/** The server's rejection when a sync for a day arrives after 12:00 AM IST (spec §6). */
export function isClosedDayError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Steps can only be uploaded for today');
}

/** Reads today's (IST) step total and uploads it. If midnight passes mid-sync, uploads the new day once. */
export async function syncToday(deps: SyncDeps): Promise<SyncResult> {
  for (let attempt = 1; ; attempt++) {
    const now = deps.now();
    const day = istToday(now);
    const raw = await deps.readSteps(istDayBounds(day).start, now);
    const steps = Math.min(MAX_STEPS, Math.max(0, Math.round(raw)));
    try {
      await deps.upload(day, steps);
      return { day, steps };
    } catch (error) {
      if (attempt === 1 && isClosedDayError(error)) continue;
      throw error;
    }
  }
}
```

`src/lib/auth-callback.ts`:
```ts
/** Reads what Supabase appended to steppool://auth-callback after Google sign-in. */
export function parseAuthCallback(url: string): { code: string } | { error: string } {
  const [beforeHash, fragment = ''] = url.split('#');
  const query = beforeHash.split('?')[1] ?? '';
  const params = new URLSearchParams([query, fragment].filter(Boolean).join('&'));
  const code = params.get('code');
  if (code) return { code };
  return { error: params.get('error_description') ?? params.get('error') ?? 'Sign-in was cancelled' };
}
```

`src/lib/reminder-dates.ts`:
```ts
// Free Apple accounts sign builds for 7 days; remind on day 6.
const REMIND_AFTER_MS = 6 * 24 * 60 * 60 * 1000;

export function expiryReminderDate(buildTimeIso: string): Date | null {
  const built = Date.parse(buildTimeIso);
  return Number.isNaN(built) ? null : new Date(built + REMIND_AFTER_MS);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib
git commit -m "Add sync core with the midnight retry, auth-callback parsing and reminder dates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Supabase client, generated types and the data layer

**Files:**
- Create: `src/lib/database.types.ts` (generated), `src/lib/supabase.ts`, `src/lib/api.ts`, `src/lib/errors.ts`

**Interfaces:**
- Consumes: `addDays` (Task 2); RPC and table names from Plan 1; `StepSource` (defined here in api.ts and re-used by Task 5).
- Produces:
  - `supabase` (typed client)
  - `type StepSource = 'apple_health' | 'health_connect'`
  - `type Group = { id: string; name: string; inviteCode: string }`
  - `type Settings = { stepGoal: number; dailyStake: number }`
  - `type MemberToday = { userId; name; avatarUrl: string | null; steps; syncedAt: string | null; balance; playsToday: boolean; leavingAfterToday: boolean }`
  - `type GroupToday = { group: Group; today: Settings; tomorrow: Settings | null; members: MemberToday[] }`
  - `type HistoryRow = { day; userId; name; steps; hit; coinsChange; stepGoal }`
  - functions: `getMyGroups(): Promise<Group[]>`, `getMyBalance(userId): Promise<number>`, `getGroupToday(groupId, today): Promise<GroupToday>`, `getHistory(groupId): Promise<HistoryRow[]>`, `createGroup(name, stepGoal, dailyStake): Promise<Group>`, `joinGroup(code): Promise<Group>`, `updateGroupSettings(groupId, stepGoal, dailyStake): Promise<void>`, `leaveGroup(groupId): Promise<void>`, `uploadSteps(day, steps, source): Promise<void>`
  - `message(e: unknown): string`

- [ ] **Step 1: Generate database types from the linked project (read-only)**

```bash
cd ~/Desktop/step-pool && source ~/.nvm/nvm.sh && nvm use >/dev/null
npx --yes supabase@2.120.0 gen types typescript --linked --schema public > src/lib/database.types.ts
grep -c "create_group\|upload_steps\|balances" src/lib/database.types.ts
```
Expected: a non-zero count, and the file starts with `export type Json`.

- [ ] **Step 2: Write the client, error helper and data layer**

`src/lib/errors.ts`:
```ts
export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
```

`src/lib/supabase.ts`:
```ts
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import type { Database } from './database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example)');
}

export const supabase = createClient<Database>(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// Refresh the session only while the app is in the foreground (Supabase's React Native guidance).
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
```

`src/lib/api.ts`:
```ts
import { supabase } from './supabase';
import { addDays } from './time';

export type StepSource = 'apple_health' | 'health_connect';
export type Group = { id: string; name: string; inviteCode: string };
export type Settings = { stepGoal: number; dailyStake: number };
export type MemberToday = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  steps: number;
  syncedAt: string | null;
  balance: number;
  playsToday: boolean;
  leavingAfterToday: boolean;
};
export type GroupToday = { group: Group; today: Settings; tomorrow: Settings | null; members: MemberToday[] };
export type HistoryRow = {
  day: string;
  userId: string;
  name: string;
  steps: number;
  hit: boolean;
  coinsChange: number;
  stepGoal: number;
};

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

const toGroup = (g: { id: string; name: string; invite_code: string }): Group =>
  ({ id: g.id, name: g.name, inviteCode: g.invite_code });

export async function getMyGroups(): Promise<Group[]> {
  const rows = unwrap(await supabase.from('groups').select('id, name, invite_code').order('created_at'));
  return rows.map(toGroup);
}

export async function getMyBalance(userId: string): Promise<number> {
  const row = unwrap(await supabase.from('balances').select('balance').eq('user_id', userId).maybeSingle());
  return row?.balance ?? 0;
}

export async function getGroupToday(groupId: string, today: string): Promise<GroupToday> {
  const tomorrow = addDays(today, 1);
  const [groupRes, settingsRes, membersRes] = await Promise.all([
    supabase.from('groups').select('id, name, invite_code').eq('id', groupId).single(),
    supabase
      .from('group_settings')
      .select('effective_from, step_goal, daily_stake')
      .eq('group_id', groupId)
      .lte('effective_from', tomorrow)
      .order('effective_from', { ascending: false })
      .limit(2),
    supabase
      .from('group_members')
      .select('user_id, joined_on, left_on, profiles(display_name, avatar_url)')
      .eq('group_id', groupId),
  ]);
  const group = unwrap(groupRes);
  const settings = unwrap(settingsRes);
  const members = unwrap(membersRes).filter((m) => m.left_on === null || m.left_on > today);
  const ids = members.map((m) => m.user_id);

  const [stepsRes, balancesRes] = await Promise.all([
    supabase.from('daily_steps').select('user_id, steps, synced_at').eq('day', today).in('user_id', ids),
    supabase.from('balances').select('user_id, balance').in('user_id', ids),
  ]);
  const steps = new Map(unwrap(stepsRes).map((s) => [s.user_id, s]));
  const balances = new Map(unwrap(balancesRes).map((b) => [b.user_id, b.balance ?? 0]));

  const current = settings.find((s) => s.effective_from <= today);
  const pending = settings.find((s) => s.effective_from === tomorrow);
  if (!current) throw new Error('This group has no settings for today');

  return {
    group: toGroup(group),
    today: { stepGoal: current.step_goal, dailyStake: current.daily_stake },
    tomorrow: pending ? { stepGoal: pending.step_goal, dailyStake: pending.daily_stake } : null,
    members: members
      .map((m) => ({
        userId: m.user_id,
        name: m.profiles?.display_name ?? 'Player',
        avatarUrl: m.profiles?.avatar_url ?? null,
        steps: steps.get(m.user_id)?.steps ?? 0,
        syncedAt: steps.get(m.user_id)?.synced_at ?? null,
        balance: balances.get(m.user_id) ?? 0,
        playsToday: m.joined_on < today,
        leavingAfterToday: m.left_on !== null,
      }))
      .sort((a, b) => b.steps - a.steps),
  };
}

export async function getHistory(groupId: string): Promise<HistoryRow[]> {
  const rows = unwrap(
    await supabase
      .from('day_results')
      .select('day, user_id, steps, hit, coins_change, step_goal, profiles(display_name)')
      .eq('group_id', groupId)
      .order('day', { ascending: false })
      .limit(1000),
  );
  return rows.map((r) => ({
    day: r.day,
    userId: r.user_id,
    name: r.profiles?.display_name ?? 'Player',
    steps: r.steps,
    hit: r.hit,
    coinsChange: r.coins_change,
    stepGoal: r.step_goal,
  }));
}

export async function createGroup(name: string, stepGoal: number, dailyStake: number): Promise<Group> {
  return toGroup(unwrap(await supabase.rpc('create_group', {
    p_name: name, p_step_goal: stepGoal, p_daily_stake: dailyStake,
  })));
}

export async function joinGroup(code: string): Promise<Group> {
  return toGroup(unwrap(await supabase.rpc('join_group', { p_invite_code: code })));
}

export async function updateGroupSettings(groupId: string, stepGoal: number, dailyStake: number): Promise<void> {
  unwrap(await supabase.rpc('update_group_settings', {
    p_group_id: groupId, p_step_goal: stepGoal, p_daily_stake: dailyStake,
  }));
}

export async function leaveGroup(groupId: string): Promise<void> {
  unwrap(await supabase.rpc('leave_group', { p_group_id: groupId }));
}

export async function uploadSteps(day: string, steps: number, source: StepSource): Promise<void> {
  unwrap(await supabase.rpc('upload_steps', { p_day: day, p_steps: steps, p_source: source }));
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. If the generated types make an embedded `profiles` an array rather than an object, read element `[0]`, and record a ruling.

- [ ] **Step 4: Commit**

```bash
git add src/lib
git commit -m "Add the Supabase client, generated types and the typed data layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Health access, sync glue, background task, reminders

**Files:**
- Create: `src/health/types.ts`, `src/health/health.ts`, `src/health/health.ios.ts`, `src/health/health.android.ts`, `src/lib/sync.ts`, `src/lib/background.ts`, `src/lib/reminders.ts`

**Interfaces:**
- Consumes: `StepSource`, `uploadSteps` (Task 4); `syncToday` (Task 3); `expiryReminderDate` (Task 3); `supabase` (Task 4).
- Produces:
  - `type HealthStatus = 'ready' | 'needs-permission' | 'needs-update' | 'unavailable'`
  - `type HealthApi = { source: StepSource | null; status(): Promise<HealthStatus>; requestAccess(): Promise<HealthStatus>; readSteps(start: Date, end: Date): Promise<number>; openSettings(): Promise<void> }`
  - `health: HealthApi` (imported as `@/health/health`; Metro picks the `.ios`/`.android` file)
  - `syncNow(): Promise<SyncResult>`, `registerBackgroundSync(): Promise<void>`, `configureNotifications(): void`, `scheduleReminders(now?: Date): Promise<boolean>`

- [ ] **Step 1: Write the health modules**

`src/health/types.ts`:
```ts
import type { StepSource } from '@/lib/api';

export type HealthStatus = 'ready' | 'needs-permission' | 'needs-update' | 'unavailable';

export type HealthApi = {
  source: StepSource | null;
  status(): Promise<HealthStatus>;
  requestAccess(): Promise<HealthStatus>;
  /** Total steps between two instants, de-duplicated across phone and watch. */
  readSteps(start: Date, end: Date): Promise<number>;
  openSettings(): Promise<void>;
};
```

`src/health/health.ts` (web / fallback, and what TypeScript resolves):
```ts
import type { HealthApi } from './types';

export const health: HealthApi = {
  source: null,
  status: async () => 'unavailable',
  requestAccess: async () => 'unavailable',
  readSteps: async () => 0,
  openSettings: async () => undefined,
};
```

`src/health/health.ios.ts`:
```ts
import {
  AuthorizationRequestStatus,
  ComparisonPredicateOperator,
  getRequestStatusForAuthorization,
  isHealthDataAvailable,
  queryStatisticsForQuantity,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import { Linking } from 'react-native';
import type { HealthApi, HealthStatus } from './types';

const STEPS = 'HKQuantityTypeIdentifierStepCount' as const;
// Release builds ignore steps typed into the Health app by hand. Dev builds
// keep them so the iOS Simulator's Health app can be used for testing.
const EXCLUDE_HAND_ENTERED = !__DEV__;

async function status(): Promise<HealthStatus> {
  if (!isHealthDataAvailable()) return 'unavailable';
  // HealthKit never reveals whether *read* access was granted, only whether we asked.
  const asked = await getRequestStatusForAuthorization({ toRead: [STEPS] });
  return asked === AuthorizationRequestStatus.unnecessary ? 'ready' : 'needs-permission';
}

export const health: HealthApi = {
  source: 'apple_health',
  status,
  async requestAccess() {
    if (!isHealthDataAvailable()) return 'unavailable';
    await requestAuthorization({ toRead: [STEPS] });
    return status();
  },
  async readSteps(start, end) {
    const result = await queryStatisticsForQuantity(STEPS, ['cumulativeSum'], {
      unit: 'count',
      filter: {
        date: { startDate: start, endDate: end },
        ...(EXCLUDE_HAND_ENTERED
          ? { NOT: [{ metadata: { withMetadataKey: 'HKWasUserEntered', operatorType: ComparisonPredicateOperator.equalTo, value: true } }] }
          : {}),
      },
    });
    return result.sumQuantity?.quantity ?? 0;
  },
  async openSettings() {
    await Linking.openURL('x-apple-health://');
  },
};
```

`src/health/health.android.ts`:
```ts
import {
  aggregateRecord,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';
import type { HealthApi, HealthStatus } from './types';

let initialized = false;
async function ensureInitialized(): Promise<boolean> {
  if (!initialized) initialized = await initialize();
  return initialized;
}

async function status(): Promise<HealthStatus> {
  const sdk = await getSdkStatus();
  if (sdk === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'needs-update';
  if (sdk !== SdkAvailabilityStatus.SDK_AVAILABLE || !(await ensureInitialized())) return 'unavailable';
  const granted = await getGrantedPermissions();
  return granted.some((p) => p.recordType === 'Steps' && p.accessType === 'read') ? 'ready' : 'needs-permission';
}

export const health: HealthApi = {
  source: 'health_connect',
  status,
  async requestAccess() {
    const before = await status();
    if (before === 'unavailable' || before === 'needs-update') return before;
    await requestPermission([
      { accessType: 'read', recordType: 'Steps' },
      { accessType: 'read', recordType: 'BackgroundAccessPermission' },
    ]);
    return status();
  },
  async readSteps(start, end) {
    await ensureInitialized();
    // The aggregate applies the user's Health Connect source priority, so a
    // Garmin/Zepp watch and the phone are not counted twice. It cannot leave
    // out hand-entered steps, so Android falls back to trust (spec §5).
    const result = await aggregateRecord({
      recordType: 'Steps',
      timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
    });
    return result.COUNT_TOTAL ?? 0;
  },
  async openSettings() {
    openHealthConnectSettings();
  },
};
```

- [ ] **Step 2: Write the sync glue, background task and reminders**

`src/lib/sync.ts`:
```ts
import { health } from '@/health/health';
import { uploadSteps } from './api';
import { syncToday, type SyncResult } from './sync-core';

/** Reads today's steps from the phone and uploads them. Throws with a message the UI can show. */
export async function syncNow(): Promise<SyncResult> {
  const source = health.source;
  if (!source) throw new Error('Step syncing works on iPhone and Android only.');
  if ((await health.status()) !== 'ready') {
    throw new Error('StepPool needs step access. Tap "Set up step access" on the home screen.');
  }
  return syncToday({
    now: () => new Date(),
    readSteps: (start, end) => health.readSteps(start, end),
    upload: (day, steps) => uploadSteps(day, steps, source),
  });
}
```

`src/lib/background.ts`:
```ts
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';
import { syncNow } from './sync';

const SYNC_TASK = 'steppool-sync';

// Must be defined at module load (the OS can start the app just to run it).
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return BackgroundTask.BackgroundTaskResult.Success;
    await syncNow();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    // Locked iPhone, no permission yet, or offline: try again next time.
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) return;
  await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 30 });
}
```

`src/lib/reminders.ts`:
```ts
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { expiryReminderDate } from './reminder-dates';

const CHANNEL = 'reminders';

export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** (Re)schedules the 23:30 sync reminder and, on iOS, the build-expiry reminder. */
export async function scheduleReminders(now: Date = new Date()): Promise<boolean> {
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Sync before midnight', body: "Open StepPool and tap Sync so today's steps count." },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 23, minute: 30, channelId: CHANNEL },
  });

  const buildTime = Constants.expoConfig?.extra?.buildTime;
  const expiry = Platform.OS === 'ios' && typeof buildTime === 'string' ? expiryReminderDate(buildTime) : null;
  if (expiry && expiry > now) {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Re-run StepPool from Xcode today', body: 'This free iPhone build stops opening tomorrow.' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: expiry },
    });
  }
  return true;
}
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: tsc exits 0, and all tests pass. If a library's real type differs from the code above (e.g. an enum name), adjust to the installed `.d.ts` and record a ruling.

- [ ] **Step 4: Commit**

```bash
git add src
git commit -m "Add Apple Health / Health Connect access, sync glue, background sync and reminders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: UI kit, session, sign-in, home and setup screens

**Files:**
- Delete: `src/app/explore.tsx`, `src/app/index.tsx` (template), `src/components/`, `src/hooks/`, `src/constants/`, `src/global.css`; template images `assets/images/{tutorial-web,react-logo*,expo-logo,logo-glow,expo-badge*}.png` and `assets/images/tabIcons/`
- Create: `src/ui/theme.ts`, `src/ui/kit.tsx`, `src/lib/session.tsx`, `src/lib/auth.ts`, `src/lib/use-async.ts`, `src/app/_layout.tsx` (replace), `src/app/sign-in.tsx`, `src/app/auth-callback.tsx`, `src/app/index.tsx`, `src/app/setup.tsx`

**Interfaces:**
- Consumes: `api` functions (Task 4), `health`, `syncNow`, `registerBackgroundSync`, `configureNotifications`, `scheduleReminders` (Task 5), `parseAuthCallback` (Task 3).
- Produces: `useTheme(): Theme`; kit components `Screen`, `Card`, `Title`, `Subtitle`, `Body`, `Muted`, `ErrorText`, `Button`, `Field`, `ProgressBar`, `Row`, `Stat`; `SessionProvider`, `useSession(): { session: Session | null; loading: boolean }`; `signInWithGoogle()`, `signOut()`; `useAsync<T>(load, deps): { data?: T; error?: string; loading: boolean; reload(): Promise<void> }`.

- [ ] **Step 1: Remove the template UI**

```bash
cd ~/Desktop/step-pool
git rm -rq src/app/explore.tsx src/app/index.tsx src/components src/hooks src/constants src/global.css
git rm -q assets/images/tutorial-web.png assets/images/react-logo*.png assets/images/expo-logo.png \
  assets/images/logo-glow.png assets/images/expo-badge*.png
git rm -rq assets/images/tabIcons
```

- [ ] **Step 2: Write the theme and UI kit**

`src/ui/theme.ts`:
```ts
import { useColorScheme } from 'react-native';

const light = {
  background: '#F6F7F9', card: '#FFFFFF', text: '#14171A', muted: '#5F6B76', border: '#E3E7EB',
  accent: '#1E9E5A', accentText: '#FFFFFF', danger: '#C93A3A', track: '#E8ECEF',
};
const dark: typeof light = {
  background: '#0F1214', card: '#1A1F23', text: '#F1F3F5', muted: '#9AA5AF', border: '#2A3137',
  accent: '#34C77B', accentText: '#0B1A12', danger: '#FF6B6B', track: '#2A3137',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
```

`src/ui/kit.tsx`:
```tsx
import type { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './theme';

export function Screen({ children, refreshing, onRefresh }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void;
}) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: t.background }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 }}>
      {children}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 28, fontWeight: '700', color: useTheme().text }}>{children}</Text>;
}
export function Subtitle({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 18, fontWeight: '600', color: useTheme().text, marginTop: 8 }}>{children}</Text>;
}
export function Body({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 16, color: useTheme().text }}>{children}</Text>;
}
export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 14, color: useTheme().muted }}>{children}</Text>;
}
export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 14, color: useTheme().danger }}>{children}</Text>;
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Muted>{label}</Muted>
      <Text style={{ fontSize: 18, fontWeight: '600', color: useTheme().text }}>{value}</Text>
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', busy, disabled }: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'link'; busy?: boolean; disabled?: boolean;
}) {
  const t = useTheme();
  const filled = kind === 'primary' || kind === 'danger';
  const background = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : 'transparent';
  const color = filled ? t.accentText : kind === 'link' ? t.muted : t.accent;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 12, backgroundColor: background,
        borderWidth: kind === 'secondary' ? 1 : 0, borderColor: t.accent, opacity: pressed || disabled ? 0.6 : 1,
      })}>
      {busy ? <ActivityIndicator color={color} /> : <Text style={{ color, fontSize: 16, fontWeight: '600' }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Muted>{label}</Muted>
      <TextInput
        placeholderTextColor={t.muted}
        style={{ borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 12, fontSize: 16, color: t.text, backgroundColor: t.card }}
        {...input}
      />
    </View>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: t.track, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: t.accent }} />
    </View>
  );
}
```

- [ ] **Step 3: Write session, auth and the async hook**

`src/lib/session.tsx`:
```tsx
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

type SessionState = { session: Session | null; loading: boolean };
const SessionContext = createContext<SessionState>({ session: null, loading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ session, loading: false }));
    return () => data.subscription.unsubscribe();
  }, []);
  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
```

`src/lib/auth.ts`:
```ts
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { parseAuthCallback } from './auth-callback';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_TO = Linking.createURL('auth-callback'); // steppool://auth-callback

/** Google sign-in in the system browser (PKCE). Resolves without a session if the user cancels. */
export async function signInWithGoogle(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_TO);
  if (result.type !== 'success') return;
  const parsed = parseAuthCallback(result.url);
  if ('error' in parsed) throw new Error(parsed.error);
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(parsed.code);
  if (exchangeError) throw exchangeError;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
```

`src/lib/use-async.ts`:
```ts
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { message } from './errors';

/** Loads data when the screen gains focus; `reload` fetches again (pull-to-refresh, after actions). */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(undefined);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, deps);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  return { data, error, loading, reload };
}
```

- [ ] **Step 4: Write the root layout and the first screens**

`src/app/_layout.tsx`:
```tsx
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { registerBackgroundSync } from '@/lib/background';
import { configureNotifications, scheduleReminders } from '@/lib/reminders';
import { SessionProvider, useSession } from '@/lib/session';
import { syncNow } from '@/lib/sync';
import { useTheme } from '@/ui/theme';

configureNotifications();

function RootStack() {
  const { session, loading } = useSession();
  const t = useTheme();
  const signedIn = !!session;

  useEffect(() => {
    if (!signedIn) return;
    void registerBackgroundSync();
    void scheduleReminders();
    void syncNow().catch(() => undefined);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow().catch(() => undefined);
    });
    return () => sub.remove();
  }, [signedIn]);

  if (loading) return null;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.background },
        headerTintColor: t.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.background },
      }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: 'StepPool' }} />
        <Stack.Screen name="setup" options={{ title: 'Step access' }} />
        <Stack.Screen name="create" options={{ title: 'New group', presentation: 'modal' }} />
        <Stack.Screen name="join" options={{ title: 'Join a group', presentation: 'modal' }} />
        <Stack.Screen name="group/[id]/index" options={{ title: 'Today' }} />
        <Stack.Screen name="group/[id]/history" options={{ title: 'History' }} />
        <Stack.Screen name="group/[id]/settings" options={{ title: 'Group settings' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <RootStack />
    </SessionProvider>
  );
}
```

`src/app/auth-callback.tsx`:
```tsx
import { Redirect } from 'expo-router';

// The browser hands sign-in back via steppool://auth-callback; the auth code is
// read in signInWithGoogle(). If the OS opens this route directly, go home.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
```

`src/app/sign-in.tsx`:
```tsx
import { useState } from 'react';
import { View } from 'react-native';
import { signInWithGoogle } from '@/lib/auth';
import { message } from '@/lib/errors';
import { Body, Button, ErrorText, Muted, Screen, Title } from '@/ui/kit';

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onPress() {
    setBusy(true);
    setError(undefined);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ marginTop: 96, marginBottom: 24, gap: 12 }}>
        <Title>StepPool</Title>
        <Body>Stake coins with your friends. Hit the daily step goal, or lose your stake to the people who did.</Body>
        <Muted>Virtual coins only. No real money.</Muted>
      </View>
      <Button title="Continue with Google" onPress={onPress} busy={busy} />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
```

`src/app/index.tsx`:
```tsx
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { health } from '@/health/health';
import type { HealthStatus } from '@/health/types';
import { getMyBalance, getMyGroups } from '@/lib/api';
import { signOut } from '@/lib/auth';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/use-async';
import { Body, Button, Card, ErrorText, Muted, Screen, Subtitle } from '@/ui/kit';
import { useTheme } from '@/ui/theme';

const HEALTH_BANNER: Record<Exclude<HealthStatus, 'ready'>, string> = {
  'needs-permission': 'StepPool can’t read your steps yet.',
  'needs-update': 'Health Connect needs an update before StepPool can read your steps.',
  unavailable: 'Step data isn’t available on this device.',
};

export default function Home() {
  const t = useTheme();
  const userId = useSession().session?.user.id ?? '';
  const { data, error, loading, reload } = useAsync(async () => {
    const [groups, balance, healthStatus] = await Promise.all([getMyGroups(), getMyBalance(userId), health.status()]);
    return { groups, balance, healthStatus };
  }, [userId]);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Card>
        <Muted>Your coins</Muted>
        <Text style={{ fontSize: 36, fontWeight: '700', color: t.text }}>{data?.balance ?? '…'}</Text>
      </Card>

      {data && data.healthStatus !== 'ready' ? (
        <Card>
          <Body>{HEALTH_BANNER[data.healthStatus]}</Body>
          <Button kind="secondary" title="Set up step access" onPress={() => router.push('/setup')} />
        </Card>
      ) : null}

      <Subtitle>Your groups</Subtitle>
      {data?.groups.map((g) => (
        <Pressable key={g.id} onPress={() => router.push({ pathname: '/group/[id]', params: { id: g.id } })}>
          <Card>
            <Body>{g.name}</Body>
            <Muted>Invite code {g.inviteCode}</Muted>
          </Card>
        </Pressable>
      ))}
      {data && data.groups.length === 0 ? <Muted>No groups yet. Create one, or join with a friend's code.</Muted> : null}

      <Button title="Create a group" onPress={() => router.push('/create')} />
      <Button kind="secondary" title="Join with a code" onPress={() => router.push('/join')} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button kind="link" title="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
```

`src/app/setup.tsx`:
```tsx
import { useState } from 'react';
import { Platform } from 'react-native';
import { health } from '@/health/health';
import type { HealthStatus } from '@/health/types';
import { syncNow } from '@/lib/sync';
import { useAsync } from '@/lib/use-async';
import { Body, Button, Card, Muted, Screen, Title } from '@/ui/kit';

const STATUS_TEXT: Record<HealthStatus, string> = {
  ready: 'Step access is on. StepPool syncs when you open it, in the background, and when you tap Sync.',
  'needs-permission': 'Allow StepPool to read your steps.',
  'needs-update': 'Update Health Connect from the Play Store, then come back.',
  unavailable: 'Step data isn’t available on this device.',
};

function PlatformNotes() {
  if (Platform.OS === 'ios') {
    return (
      <Card>
        <Body>iPhone + Apple Watch</Body>
        <Muted>StepPool reads the same step total the Health app shows, which already merges your iPhone and Apple Watch.</Muted>
        <Muted>If your steps stay at 0: Settings → Health → Data Access & Devices → StepPool → turn on Steps.</Muted>
      </Card>
    );
  }
  return (
    <Card>
      <Body>Android + Garmin or Amazfit</Body>
      <Muted>1. In Garmin Connect (or Zepp), turn on syncing to Health Connect.</Muted>
      <Muted>2. In Health Connect → Data and access → Steps → Data sources and priority, put Garmin Connect or Zepp first.</Muted>
      <Muted>3. Allow StepPool to read steps, including in the background.</Muted>
      <Muted>Before midnight, open Garmin Connect or Zepp first so your watch’s latest steps reach the phone.</Muted>
    </Card>
  );
}

export default function Setup() {
  const { data: status, reload } = useAsync(() => health.status(), []);
  const [busy, setBusy] = useState(false);

  async function allow() {
    setBusy(true);
    try {
      await health.requestAccess();
      await syncNow().catch(() => undefined);
    } finally {
      setBusy(false);
      void reload();
    }
  }

  return (
    <Screen>
      <Title>Step access</Title>
      <Body>{STATUS_TEXT[status ?? 'needs-permission']}</Body>
      <PlatformNotes />
      {status === 'needs-permission' ? <Button title="Allow step access" onPress={allow} busy={busy} /> : null}
      <Button
        kind="secondary"
        title={Platform.OS === 'ios' ? 'Open the Health app' : 'Open Health Connect'}
        onPress={() => void health.openSettings()}
      />
    </Screen>
  );
}
```

- [ ] **Step 5: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: tsc exits 0 (typed routes are not generated until `expo start`, so links to the Task 7 screens are plain strings) and all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add UI kit, session and Google sign-in, home and step-access screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Group screens (create, join, today, history, settings)

**Files:**
- Create: `src/app/create.tsx`, `src/app/join.tsx`, `src/app/group/[id]/index.tsx`, `src/app/group/[id]/history.tsx`, `src/app/group/[id]/settings.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–6.

- [ ] **Step 1: Create and join**

`src/app/create.tsx`:
```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { createGroup } from '@/lib/api';
import { message } from '@/lib/errors';
import { Button, ErrorText, Field, Muted, Screen } from '@/ui/kit';

const toInt = (s: string) => Number.parseInt(s.replace(/\D/g, ''), 10);

export default function Create() {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('10000');
  const [stake, setStake] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const group = await createGroup(name, toInt(goal), toInt(stake));
      router.replace({ pathname: '/group/[id]', params: { id: group.id } });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field label="Group name" value={name} onChangeText={setName} placeholder="Walk Squad" maxLength={40} />
      <Field label="Daily step goal" value={goal} onChangeText={setGoal} keyboardType="number-pad" />
      <Field label="Daily stake (coins)" value={stake} onChangeText={setStake} keyboardType="number-pad" />
      <Muted>With 4 people, a stake that’s a multiple of 6 (like 30) always splits evenly.</Muted>
      <Muted>Everyone starts playing the day after they join. Share the invite code today so you all start tomorrow.</Muted>
      <Button title="Create group" onPress={submit} busy={busy} />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
```

`src/app/join.tsx`:
```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { joinGroup } from '@/lib/api';
import { message } from '@/lib/errors';
import { Button, ErrorText, Field, Muted, Screen } from '@/ui/kit';

export default function Join() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const group = await joinGroup(code);
      router.replace({ pathname: '/group/[id]', params: { id: group.id } });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field label="Invite code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="K7Q2MP" />
      <Muted>You start playing tomorrow.</Muted>
      <Button title="Join group" onPress={submit} busy={busy} />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
```

- [ ] **Step 2: The today screen**

`src/app/group/[id]/index.tsx`:
```tsx
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { getGroupToday, type MemberToday } from '@/lib/api';
import { message } from '@/lib/errors';
import { formatAgo, formatCoins, formatCountdown } from '@/lib/format';
import { previewDay } from '@/lib/preview';
import { useSession } from '@/lib/session';
import { syncNow } from '@/lib/sync';
import { istToday, msUntilIstMidnight } from '@/lib/time';
import { useAsync } from '@/lib/use-async';
import { Body, Button, Card, ErrorText, Muted, ProgressBar, Row, Screen, Stat } from '@/ui/kit';

function MemberCard({ member, goal, isMe, change, now }: {
  member: MemberToday; goal: number; isMe: boolean; change: number | undefined; now: Date;
}) {
  const status = !member.playsToday
    ? 'Joined today, plays from tomorrow'
    : change === undefined || change === 0
      ? 'No coins move if the day ended now'
      : `${formatCoins(change)} if the day ended now`;
  return (
    <Card>
      <Row>
        <Body>{isMe ? `${member.name} (you)` : member.name}</Body>
        <Body>{member.steps.toLocaleString()} / {goal.toLocaleString()}</Body>
      </Row>
      <ProgressBar value={member.steps / goal} />
      <Muted>{status}</Muted>
      <Muted>
        {member.syncedAt ? `Synced ${formatAgo(member.syncedAt, now)}` : 'Not synced today'}
        {member.leavingAfterToday ? ' · leaving after today' : ''}
        {` · ${member.balance} coins`}
      </Muted>
    </Card>
  );
}

export default function GroupToday() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useSession().session?.user.id;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const today = istToday(now);
  const { data, error, loading, reload } = useAsync(() => getGroupToday(id, today), [id, today]);
  const [sync, setSync] = useState<{ busy: boolean; note?: string }>({ busy: false });

  async function onSync() {
    setSync({ busy: true });
    try {
      const result = await syncNow();
      setSync({ busy: false, note: `Synced ${result.steps.toLocaleString()} steps` });
      await reload();
    } catch (e) {
      setSync({ busy: false, note: message(e) });
    }
  }

  if (!data) {
    return (
      <Screen refreshing={loading} onRefresh={reload}>
        {error ? <ErrorText>{error}</ErrorText> : <Muted>Loading…</Muted>}
      </Screen>
    );
  }

  const players = data.members.filter((m) => m.playsToday);
  const preview = previewDay(
    data.today.stepGoal,
    data.today.dailyStake,
    players.map((m) => ({ userId: m.userId, steps: m.steps, balance: m.balance })),
  );

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: data.group.name }} />
      <Card>
        <Row>
          <Stat label="Goal" value={data.today.stepGoal.toLocaleString()} />
          <Stat label="Stake" value={`${data.today.dailyStake} coins`} />
          <Stat label="Closes in" value={formatCountdown(msUntilIstMidnight(now))} />
        </Row>
        {data.tomorrow ? (
          <Muted>From tomorrow: {data.tomorrow.stepGoal.toLocaleString()} steps, {data.tomorrow.dailyStake} coins</Muted>
        ) : null}
      </Card>

      <Button title="Sync now" onPress={onSync} busy={sync.busy} />
      {sync.note ? <Muted>{sync.note}</Muted> : null}

      {data.members.map((m) => (
        <MemberCard key={m.userId} member={m} goal={data.today.stepGoal} isMe={m.userId === me} change={preview[m.userId]} now={now} />
      ))}
      <Muted>Results are calculated at 12:00 AM IST. Steps synced after midnight don’t count.</Muted>

      <Row>
        <Button kind="secondary" title="History" onPress={() => router.push({ pathname: '/group/[id]/history', params: { id } })} />
        <Button kind="secondary" title="Settings" onPress={() => router.push({ pathname: '/group/[id]/settings', params: { id } })} />
      </Row>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
```

- [ ] **Step 3: History and settings**

`src/app/group/[id]/history.tsx`:
```tsx
import { useLocalSearchParams } from 'expo-router';
import { getHistory } from '@/lib/api';
import { formatCoins, formatDay } from '@/lib/format';
import { buildLeaderboard, groupByDay } from '@/lib/leaderboard';
import { useAsync } from '@/lib/use-async';
import { Body, Card, ErrorText, Muted, Row, Screen, Subtitle } from '@/ui/kit';

export default function History() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data = [], error, loading, reload } = useAsync(() => getHistory(id), [id]);
  const names = new Map(data.map((r) => [r.userId, r.name]));
  const board = buildLeaderboard(data);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      {data.length === 0 && !loading ? (
        <Muted>No results yet. The first day is scored at 12:00 AM after everyone has played a full day.</Muted>
      ) : null}

      {board.length > 0 ? <Subtitle>Leaderboard</Subtitle> : null}
      {board.length > 0 ? (
        <Card>
          {board.map((r, i) => (
            <Row key={r.userId}>
              <Body>{i + 1}. {names.get(r.userId) ?? 'Player'}</Body>
              <Muted>{r.daysHit}/{r.daysPlayed} days · streak {r.streak}</Muted>
              <Body>{formatCoins(r.net)}</Body>
            </Row>
          ))}
        </Card>
      ) : null}

      {data.length > 0 ? <Subtitle>Day by day</Subtitle> : null}
      {groupByDay(data).map(({ day, rows }) => (
        <Card key={day}>
          <Body>{formatDay(day)} · goal {rows[0].stepGoal.toLocaleString()}</Body>
          {rows.map((r) => (
            <Row key={r.userId}>
              <Muted>{r.hit ? '✅' : '❌'} {r.name}</Muted>
              <Muted>{r.steps.toLocaleString()} steps</Muted>
              <Body>{formatCoins(r.coinsChange)}</Body>
            </Row>
          ))}
        </Card>
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
```

`src/app/group/[id]/settings.tsx`:
```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Share } from 'react-native';
import { getGroupToday, leaveGroup, updateGroupSettings } from '@/lib/api';
import { message } from '@/lib/errors';
import { istToday } from '@/lib/time';
import { useAsync } from '@/lib/use-async';
import { Body, Button, Card, ErrorText, Field, Muted, Screen, Subtitle } from '@/ui/kit';

const toInt = (s: string) => Number.parseInt(s.replace(/\D/g, ''), 10);

export default function GroupSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = istToday();
  const { data } = useAsync(() => getGroupToday(id, today), [id, today]);
  const [goal, setGoal] = useState<string>();
  const [stake, setStake] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();

  if (!data) return <Screen><Muted>Loading…</Muted></Screen>;
  const upcoming = data.tomorrow ?? data.today;
  const goalText = goal ?? String(upcoming.stepGoal);
  const stakeText = stake ?? String(upcoming.dailyStake);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await updateGroupSettings(id, toInt(goalText), toInt(stakeText));
      setNote('Saved. The new goal and stake start tomorrow.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmLeave() {
    Alert.alert('Leave this group?', 'You still play today, and can still lose today’s stake. You leave from tomorrow.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          leaveGroup(id).then(() => router.replace('/'), (e) => setError(message(e)));
        },
      },
    ]);
  }

  return (
    <Screen>
      <Subtitle>Invite</Subtitle>
      <Card>
        <Body>Invite code: {data.group.inviteCode}</Body>
        <Button
          kind="secondary"
          title="Share invite"
          onPress={() => void Share.share({ message: `Join my StepPool group "${data.group.name}" with code ${data.group.inviteCode}` })}
        />
      </Card>

      <Subtitle>Goal and stake</Subtitle>
      <Card>
        <Muted>Today: {data.today.stepGoal.toLocaleString()} steps, {data.today.dailyStake} coins. Changes start tomorrow.</Muted>
        <Field label="Daily step goal" value={goalText} onChangeText={setGoal} keyboardType="number-pad" />
        <Field label="Daily stake (coins)" value={stakeText} onChangeText={setStake} keyboardType="number-pad" />
        <Button title="Save for tomorrow" onPress={save} busy={busy} />
        {note ? <Muted>{note}</Muted> : null}
      </Card>

      <Button kind="danger" title="Leave group" onPress={confirmLeave} />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
```

- [ ] **Step 4: Typecheck, test, and confirm the bundle builds for both platforms**

```bash
cd ~/Desktop/step-pool && source ~/.nvm/nvm.sh && nvm use >/dev/null
npm run typecheck && npm test
mkdir -p .superpowers/logs
npx expo export --platform ios --platform android --output-dir .superpowers/logs/export > .superpowers/logs/export.log 2>&1; tail -5 .superpowers/logs/export.log
```
Expected: tsc exits 0, all tests pass, and `expo export` finishes with bundles for ios and android. This proves Metro resolves every import, including the `.ios`/`.android` health files.

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "Add group screens: create, join, today with live preview, history and settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Release builds and the friends' install guide

**Files:**
- Modify: `README.md` (build, install and friend instructions)

**Interfaces:**
- Consumes: the complete app.

- [ ] **Step 1: Build the Android release APK locally (Android Studio's JDK, no Expo account)**

```bash
cd ~/Desktop/step-pool && source ~/.nvm/nvm.sh && nvm use >/dev/null
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
mkdir -p .superpowers/logs
npx expo prebuild --platform android --clean --no-install > .superpowers/logs/prebuild-android.log 2>&1
(cd android && ./gradlew assembleRelease) > .superpowers/logs/gradle.log 2>&1; tail -5 .superpowers/logs/gradle.log
ls -la android/app/build/outputs/apk/release/
```
Expected: `BUILD SUCCESSFUL` and `app-release.apk`. Expo's template signs release builds with its bundled debug keystore, so the APK installs on any phone and later builds install over it.

- [ ] **Step 2: Write the build and install guide**

Append to `README.md`:
````markdown
## The app

Expo SDK 57 app in `src/` (expo-router screens in `src/app`). It talks to the
Supabase project in `.env.local` (copy `.env.example`). Native folders `ios/`
and `android/` are generated by `npx expo prebuild` and are not committed.

### Android (APK, no store, no account)

```bash
nvm use
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
npx expo prebuild --platform android --clean
(cd android && ./gradlew assembleRelease)
# → android/app/build/outputs/apk/release/app-release.apk
```

Send the APK (Google Drive, WhatsApp, …). On the phone, open it and allow
"Install unknown apps" when asked. Then in StepPool, tap **Set up step access**.

### iPhone (free Apple account, re-run every 7 days)

Needs a Mac with Xcode and the iPhone plugged in (Developer Mode on).

```bash
nvm use && npm ci
cp .env.example .env.local   # fill in the two values
IOS_BUNDLE_ID=com.<yourname>.steppool npx expo run:ios --device --configuration Release
```

The first time, pick your **Personal Team** when asked for a signing team. On
the iPhone, trust the developer under Settings → General → VPN & Device
Management. Free builds stop opening after 7 days, and the app reminds you on
day 6: plug in and run the same command again.

### After a fresh `supabase db push`

In the Supabase SQL editor:
`select jobname, schedule, active from cron.job;` should show
`score-pending-days | 30 * * * * | true`.
In Authentication → Sign In / Providers, keep only **Google** enabled.
````

- [ ] **Step 3: Full verification and commit**

Run: `npm test && npm run typecheck`
Expected: all pass.

```bash
git add README.md
git commit -m "Document Android APK and free-account iPhone builds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Manual checks (needs the accounts and devices)**

These need Google sign-in configured (setup Step B) and devices. They are run with the owner and are not part of the automated contract:
1. Android phone with Garmin: install the APK, sign in with Google, grant step access, tap Sync. The steps match Health Connect's total.
2. iOS Simulator (once Xcode is installed): `npx expo run:ios`, sign in, add steps in the Simulator's Health app, tap Sync (a dev build includes hand-entered steps).
3. Both: create a group, join it from the second device, check that the Today screen shows both members and the preview line.
