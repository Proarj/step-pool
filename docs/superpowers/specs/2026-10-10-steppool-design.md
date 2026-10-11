# StepPool — Design Spec

**Date:** 2026-10-10
**Status:** Approved in chat; awaiting written-spec review

## 1. Purpose

A private app for one group of 4 friends. Each person stakes their own number
of **virtual coins** each day, the group shares a daily step goal, and anyone
who misses the goal pays their stake to the people who hit it, in proportion to
the winners' stakes. Steps sync
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
- **Stake:** each member sets their **own** daily stake, 1–1,000 coins, when
  they create or join the group. They can change it at any time, and the change
  takes effect **tomorrow** (IST). *(Changed 2026-10-11: replaced the earlier
  "same stake for everyone".)*
- **Goal:** one step goal per group. Any member can change it, and the change
  takes effect **tomorrow** (IST).
- **Joining:** by invite code. A member first takes part on the day **after**
  they join.
- **Leaving:** takes effect **tomorrow**. You still play, and can still lose,
  on the day you leave. Re-joining before then cancels the leave. Once a leave
  has taken effect, re-joining counts as a fresh join. *(Changed 2026-10-10
  after review: the earlier "left before midnight isn't scored" rule let anyone
  dodge a bad day by leaving and re-joining.)*
- **No wallet:** everyone starts at 0. A person's total is coins won minus
  coins lost, and it can go negative. Losers always pay their full stake (minus
  rounding). There are no top-ups and no balance caps. *(Changed 2026-10-11:
  replaced the 1,000-coin wallet and the 200 top-up.)*
- **Fresh start:** the 2026-10-11 rules update wipes all game data (groups,
  members, goals, stakes, steps, results). Accounts and profiles stay.
- **Upload cutoff:** the server only accepts uploads for **today** (IST). At
  12:00 AM, yesterday closes.
- **Scoring time:** 12:00 AM IST sharp, with hourly catch-up runs.

### Scoring algorithm (per group, per unscored day D before today)

1. Goal for D = the `group_settings` row with the latest `effective_from <= D`.
2. Participants = members with `joined_on < D` and (`left_on` is null or
   `left_on > D`). Each participant's stake = their `member_stakes` row with the
   latest `effective_from <= D`. If there are no participants, mark D scored
   and stop.
3. For each participant: `steps` = their `daily_steps` total for D, or 0 if none.
   `hit = steps >= goal`.
4. If there are **no winners** or **no losers**, nobody's coins change.
5. Otherwise let `W` = the sum of the winners' stakes. Each loser L pays each
   winner V `floor(stake_L × stake_V / W)` coins. Each payment is recorded in
   `day_transfers`, and zero amounts are skipped. A loser's loss is the sum of
   what they pay. Rounding can leave up to (winners − 1) coins of their stake
   with them, and no coins disappear.
6. Write `day_results` for every participant: `coins_change` = received − paid.
   Mark D in `scored_days`. All of this happens in **one transaction**. A day
   that is already scored is skipped, so re-running is safe.

**Worked example** (goal 10,000): You stake 50 and hit, Ben stakes 100 and hits,
Cara stakes 60 and misses. `W` = 150. Cara → You `floor(60×50/150)` = 20,
Cara → Ben `floor(60×100/150)` = 40. Cara −60, You +20, Ben +40. If Cara had
staked 50, she would pay 16 and 33 and keep 1 coin.

## 4. Data model (Postgres)

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` (= `auth.users.id`), `display_name`, `avatar_url`, `created_at` | Created by a trigger on sign-up |
| `groups` | `id`, `name`, `invite_code` (6 chars, unique), `created_by`, `created_at` | |
| `group_settings` | `group_id`, `effective_from` (date), `step_goal` | PK (`group_id`, `effective_from`). A change upserts the row for tomorrow |
| `member_stakes` | `group_id`, `user_id`, `effective_from` (date), `stake` | PK (`group_id`, `user_id`, `effective_from`). Create, join and changes all upsert the row for tomorrow |
| `group_members` | `group_id`, `user_id`, `joined_on` (date, IST), `left_on` (date, nullable: the first day they no longer play) | PK (`group_id`, `user_id`). Rows are kept after leaving |
| `daily_steps` | `user_id`, `day` (date), `steps`, `source` (`apple_health` \| `health_connect`), `synced_at` | PK (`user_id`, `day`). Each upload upserts the latest total |
| `day_transfers` | `group_id`, `day`, `from_user`, `to_user`, `amount` (> 0) | PK (`group_id`, `day`, `from_user`, `to_user`). Who paid whom, per day |
| `day_results` | `group_id`, `day`, `user_id`, `steps`, `step_goal`, `stake`, `hit`, `coins_change` | Snapshot used by the History screen |
| `group_totals` (view) | `group_id`, `user_id`, `total` | `sum(coins_change)` per person per group. `security_invoker`, so it follows `day_results` RLS |
| `scored_days` | `group_id`, `day`, `scored_at` | Lock table. PK (`group_id`, `day`) |

**Validation:** step goal 1,000–100,000. Stake 1–1,000. Uploaded steps 0–100,000.

### Server functions (the only way to write)

| Function | Who calls it | What it does |
|---|---|---|
| `create_group(name, step_goal, stake)` | App | Creates the group, its first goal row, and the creator's membership and stake, then returns the invite code |
| `join_group(invite_code, stake)` | App | Adds the caller as a member (`joined_on` = today) and sets their stake from tomorrow |
| `update_group_settings(group_id, step_goal)` | App (active members only) | Upserts the goal row for tomorrow |
| `set_my_stake(group_id, stake)` | App (active members only) | Upserts the caller's stake for tomorrow |
| `upload_steps(day, steps, source)` | App | Rejects anything where `day ≠ today (IST)` or `steps` is out of range, then upserts |
| `leave_group(group_id)` | App | Sets `left_on` = tomorrow. The person stops seeing the group once it takes effect, and past results (with their name) stay |
| `score_pending_days()` | pg_cron, hourly at :00 IST | Runs the scoring algorithm for every unscored day before today |

### Security (Row Level Security)

- Members can read groups, settings, members, `daily_steps`, `day_results` and
  profiles **only for groups they belong to**.
- Members can read `member_stakes`, `day_transfers` and `group_totals` for
  their groups.
- **No direct inserts or updates from the app** on any table. All writes go
  through the functions above. `day_transfers`, `day_results` and `scored_days`
  are written only by `score_pending_days()`.
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
3. **Home:** your overall total across groups, my groups, Create group, Join
   with code (create and join both ask for your stake).
4. **Group (today):**
   - Goal, your stake, and a countdown to midnight IST. Each member's stake.
   - Each member's steps today, with a progress bar and "synced N min ago".
   - A **Sync now** button.
   - A live preview ("If the day ended now: Cara → You 20"), using the same
     rules as scoring and computed on the client.
5. **History:**
   - A leaderboard: each person's total (net coins), days the goal was hit,
     and current streak.
   - An **Overall** card: who owes whom, netted per pair ("Cara owes you 45").
   - Per-day results with that day's payments.
6. **Group settings:** change the group goal and your own stake (both shown as
   "from tomorrow"), share the invite code, leave the group.

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
  proportional split with unequal stakes, rounding left with the loser,
  everyone missed, nobody missed, member who joined on D (excluded), goal and
  stake changes taking effect the next day, running twice (idempotent),
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
