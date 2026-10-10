# StepPool — Design Spec

**Date:** 2026-10-10
**Status:** Approved in chat; awaiting written-spec review

## 1. Purpose

A private app for one group of 4 friends. Everyone stakes the same number of
**virtual coins** each day, the group shares a daily step goal, and anyone who
misses the goal loses their stake to the people who hit it. Steps sync
automatically from each person's phone. Nobody types numbers or posts screenshots.

### Users and devices

| Person | Phone | Wearable | Step source on phone |
|---|---|---|---|
| Owner | Android | Garmin | Garmin Connect → Health Connect |
| Friend | Android | Amazfit | Zepp → Health Connect |
| Friend ×2 | iPhone | Apple Watch | Apple Health |

### Success criteria

1. All 4 have the app installed: Android via an APK link, iPhone via Xcode.
2. Steps reach the server with no manual entry: automatically, plus a Sync now button.
3. At 12:00 AM IST every day, yesterday is scored automatically and coins move.
4. Everyone can see a history of results and a leaderboard.
5. Running cost is $0.

### Non-goals (v1)

Real money, buying or cashing out coins, a website version, chat, remote push
notifications, friend requests or discovery, and time zones other than IST.

## 2. Architecture

```
 Apple Watch ──► Apple Health ─────┐
                                   ├──► StepPool app ── upload today's total ──► Supabase
 Garmin / Amazfit ──► Garmin       │    (Expo, TS)                               • Auth (Google)
   Connect / Zepp ──► Health ──────┘                                             • Postgres + RLS
                      Connect                                                    • pg_cron scoring job
                                                ◄──── scoreboard & history ─────
```

| Component | Responsibility | Technology |
|---|---|---|
| Mobile app | Login, UI, reading steps, uploading, local reminders | Expo (React Native, TypeScript), expo-router |
| Step reading (iOS) | Today's deduplicated step total from Apple Health | `@kingstinct/react-native-healthkit` (to be confirmed during planning) |
| Step reading (Android) | Today's deduplicated step total from Health Connect | `react-native-health-connect` + `expo-health-connect` plugin |
| Backend | Accounts, data, security rules, scoring | Supabase (free tier): Auth, Postgres, RLS, pg_cron |
| Login provider | Google sign-in | Google Cloud OAuth client in **Testing** mode, 4 test users |
| Android distribution | Installable APK link | EAS Build (free tier), `preview` profile |
| iOS distribution | Installs on the two iPhones | Xcode on this Mac or a friend's Mac, **Release** configuration, free Apple ID, re-run every 7 days |

**Key principle:** scoring runs **only on the server**. Phones only ever upload
"my step total for today = N".

## 3. Rules (agreed)

- **Time zone:** IST (`Asia/Kolkata`) everywhere, app-wide. A "day" runs from
  00:00 to 24:00 IST, whatever the phone's own time zone is.
- **Stake:** the same for everyone in the group, set by the group (option C).
- **Goal and stake changes:** any member can change them. Changes take effect
  **tomorrow** (IST).
- **Joining:** by invite code. A member first takes part on the day **after**
  they join.
- **Leaving:** takes effect **tomorrow**. You still play, and can still lose,
  on the day you leave. Re-joining before then cancels the leave. Once a leave
  has taken effect, re-joining counts as a fresh join. *(Changed 2026-10-10
  after review: the earlier "left before midnight isn't scored" rule let anyone
  dodge a bad day by leaving and re-joining.)*
- **Wallet:** +1,000 coins on first sign-in. If a person's balance is 0 after
  scoring, they get +200.
- **Upload cutoff:** the server only accepts uploads for **today** (IST). At
  12:00 AM, yesterday closes.
- **Scoring time:** 12:00 AM IST sharp, with hourly catch-up runs.

### Scoring algorithm (per group, per unscored day D before today)

1. Settings for D = the `group_settings` row with the latest `effective_from <= D`.
2. Participants = members with `joined_on < D` and (`left_on` is null or
   `left_on > D`). If there are no participants, mark D scored and stop.
3. For each participant: `steps` = their `daily_steps` total for D, or 0 if none.
   `hit = steps >= goal`.
4. Each loser's loss = `min(stake, current balance)`. `pot` = sum of the losses.
5. If there are **no winners** or `pot = 0`, nobody's coins change.
6. Otherwise each winner gets `floor(pot / winners)`. Any remainder (at most
   `winners − 1` coins) isn't awarded to anyone; it disappears. With 4 members,
   a stake that's a multiple of 6 never leaves a remainder.
7. Any participant whose balance is now 0 gets +200 (`top_up`).
8. Write `day_results` for every participant and mark D in `scored_days`. All of
   this happens in **one transaction**. A day that is already scored is skipped,
   so re-running is safe.

Groups are scored in a fixed order (by `created_at`). This matters only if one
person is in several groups, because their balance changes between groups.

**Worked example** (goal 10,000, stake 30): You 12,400 ✅ +30, A 10,050 ✅ +30,
B 9,800 ❌ −30, C 4,000 ❌ −30. With stake 50 and one loser: each of the 3
winners gets 16, and the remaining 2 coins disappear.

## 4. Data model (Postgres)

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` (= `auth.users.id`), `display_name`, `avatar_url`, `created_at` | Created by a trigger on sign-up. The trigger also writes the +1,000 welcome entry |
| `groups` | `id`, `name`, `invite_code` (6 chars, unique), `created_by`, `created_at` | |
| `group_settings` | `group_id`, `effective_from` (date), `step_goal`, `daily_stake` | PK (`group_id`, `effective_from`). A change upserts the row for tomorrow |
| `group_members` | `group_id`, `user_id`, `joined_on` (date, IST), `left_on` (date, nullable: the first day they no longer play) | PK (`group_id`, `user_id`). Rows are kept after leaving |
| `daily_steps` | `user_id`, `day` (date), `steps`, `source` (`apple_health` \| `health_connect`), `synced_at` | PK (`user_id`, `day`). Each upload upserts the latest total |
| `coin_ledger` | `id`, `user_id`, `group_id` (nullable), `day` (nullable), `amount`, `reason` (`welcome` \| `won` \| `lost` \| `top_up`), `created_at` | Balance = `sum(amount)` |
| `day_results` | `group_id`, `day`, `user_id`, `steps`, `step_goal`, `daily_stake`, `hit`, `coins_change` | Snapshot used by the History screen |
| `scored_days` | `group_id`, `day`, `scored_at` | Lock table. PK (`group_id`, `day`) |

**Validation:** step goal 1,000–100,000. Daily stake 1–1,000. Uploaded steps 0–100,000.

### Server functions (the only way to write)

| Function | Who calls it | What it does |
|---|---|---|
| `create_group(name, step_goal, daily_stake)` | App | Creates the group, its first settings row and the creator's membership, and returns the invite code |
| `join_group(invite_code)` | App | Adds the caller as a member, with `joined_on` = today |
| `update_group_settings(group_id, step_goal, daily_stake)` | App (members only) | Upserts the settings row for tomorrow |
| `upload_steps(day, steps, source)` | App | Rejects anything where `day ≠ today (IST)` or `steps` is out of range, then upserts |
| `leave_group(group_id)` | App | Sets `left_on` = tomorrow. The person stops seeing the group once it takes effect, and past results (with their name) stay |
| `score_pending_days()` | pg_cron, hourly at :00 IST | Runs the scoring algorithm for every unscored day before today |

### Security (Row Level Security)

- Members can read groups, settings, members, `daily_steps`, `day_results` and
  profiles **only for groups they belong to**.
- People can read the `coin_ledger` rows of themselves and fellow group members.
  The `balances` view (`security_invoker`) sums them, so fellow members see each
  other's balances.
- **No direct inserts or updates from the app** on any table. All writes go
  through the functions above. `coin_ledger`, `day_results` and `scored_days`
  are written only by `score_pending_days()` and the sign-up trigger.
- The app ships only the Supabase anon key. The service role key never leaves
  Supabase.

## 5. Mobile app

### Screens (expo-router)

1. **Sign in:** "Continue with Google". Uses the browser-based OAuth flow
   (Supabase PKCE, `expo-web-browser`, app scheme `steppool://`). This works no
   matter what each iOS bundle ID is.
2. **Setup:** asks for step permission.
   - Android: explains how to rank Garmin Connect or Zepp first in Health
     Connect's data sources, and links to Health Connect. On Android 13 and
     older it links to the Health Connect app on the Play Store.
3. **Home:** coin balance, my groups, Create group, Join with code.
4. **Group (today):**
   - Goal, stake, and a countdown to midnight IST.
   - Each member's steps today, with a progress bar and "synced N min ago".
   - A **Sync now** button.
   - A live preview ("If the day ended now: …"), using the same rules as
     scoring and computed on the client.
5. **History:** per-day results and a leaderboard showing total coins won/lost,
   days the goal was hit, and current streak.
6. **Group settings:** change goal and stake (shown as "from tomorrow"), share
   the invite code, leave the group.

### Step sync

- **When:** on app open or return to the foreground, on Sync now, and in the
  background via `expo-background-task`. Background runs are best effort: the
  OS decides timing, and a locked iPhone can't read Apple Health. On Android,
  background runs need Health Connect's background-read permission. If that
  isn't granted, background sync is skipped on that phone.
- **What:** today's total from 00:00 IST to now, uploaded with `upload_steps`.
- **iOS:** Apple Health statistics query (cumulative sum). Apple merges Watch
  and iPhone data.
- **Android:** Health Connect aggregate for steps, which applies the user's
  source priority.
- **Hand-entered steps:** excluded where the platform API allows it without
  losing de-duplication. Where it can't, we fall back to trust and say so in
  the README.

### Local notifications (`expo-notifications`)

- Daily at 23:30 IST: "Sync your steps before midnight."
- iOS builds only: 6 days after the build time (embedded at build time through
  `app.config.ts`): "Re-run StepPool from Xcode today, this build expires tomorrow."

## 6. Error handling

| Situation | Behaviour |
|---|---|
| Offline on sync | Shows "Couldn't sync, check your connection" and retries on next open or foreground |
| Step permission missing | Banner with platform-specific instructions to fix it |
| Wearable hasn't synced to the phone | The UI shows each member's last sync time |
| Upload after midnight for yesterday | Rejected. The app silently uploads today instead |
| Scoring job failed or late | The hourly run scores every unscored past day. The upload cutoff doesn't move |
| iOS build expired | Can't be prevented. The day-6 reminder covers it |
| Supabase free project paused (about 7 days with no activity) | Daily syncs prevent it. Un-pause from the dashboard if it happens |

## 7. Testing

- **Scoring and server functions:** automated SQL tests against a real local
  Postgres. Docker isn't installed, so the plan chooses the runner. Cases:
  2W/2L split, single loser with a remainder, everyone missed, nobody missed,
  loser with a low balance, top-up to 200, member who joined on D (excluded),
  settings change taking effect the next day, running twice (idempotent),
  upload for a past day rejected, and RLS (a non-member can't read a group).
- **Client logic:** unit tests for IST day boundaries and the "if the day ended
  now" preview (Vitest, the same runner as the SQL tests).
- **SQL test runner:** PGlite (Postgres compiled to WebAssembly, runs inside
  Node) with Supabase-like stubs for `auth.uid()`, the `anon`/`authenticated`
  roles and Supabase's default grants. This works without Docker.
- **Step reading:** manual tests: iOS Simulator with sample Health data, then
  the owner's Android phone with Garmin, then the real iPhones with Apple Watch.

## 8. Setup and distribution

0. **Toolchain:** Node.js 24 via nvm, pinned in `.nvmrc`. Expo SDK 57 / React
   Native 0.86 need Node ≥ 22.13.
1. **Supabase:** a free project. Migrations are applied with the Supabase CLI
   or the SQL editor.
2. **Google Cloud:** a project, OAuth consent screen (External, Testing, 4 test
   users), and a Web client ID and secret pasted into Supabase Auth → Google.
   The redirect `steppool://auth-callback` is added to Supabase's allowed
   redirect URLs.
3. **Expo account (free):** EAS Build `preview` profile → APK link for the two
   Android phones.
4. **iOS:** Xcode with a free Apple ID.
   - Build with `npx expo run:ios --device --configuration Release`.
   - Release is required so the app runs without the Mac's dev server.
   - Each Apple ID needs a unique bundle ID, read from the env var
     `IOS_BUNDLE_ID` in `app.config.ts`.

### Project layout

```
step-pool/
  src/app/             expo-router screens (Expo SDK 57 template layout)
  src/lib/             supabase client, time (IST), sync, preview logic
  src/health/          health.ios.ts, health.android.ts (same interface)
  supabase/migrations/ SQL schema, RLS, functions, cron
  supabase/tests/      SQL tests
  docs/superpowers/    specs and plans
```

## 9. Risks and open items

1. **Background sync reliability:** best effort on both platforms. Mitigated by
   Sync now and the 23:30 reminder.
2. **Excluding hand-entered steps:** it isn't yet confirmed that this can be
   done without breaking de-duplication. To be checked during implementation.
3. **iOS 7-day expiry:** an operational burden, mitigated by a reminder. The
   upgrade path is a $99/yr Apple Developer account plus EAS internal
   distribution, with no code changes.
4. **Health library APIs:** exact versions and APIs are confirmed against the
   installed packages during planning, not assumed.
