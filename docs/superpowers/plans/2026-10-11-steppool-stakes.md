# StepPool Per-Person Stakes Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "same stake for everyone, 1,000-coin wallet" with
per-person stakes. Losers pay winners in proportion to the winners' stakes, the
app shows who owes whom, totals start at 0, and all game data is reset.

**Architecture:** One new migration (`20261011000001_stakes.sql`) does six
things:
- wipes the game data;
- drops the coin ledger and balances;
- adds `member_stakes`, `day_transfers` and the `group_totals` view;
- replaces the group RPCs (`create_group`, `join_group`,
  `update_group_settings`, plus the new `set_my_stake`);
- rewrites `score_group_day` so it records pairwise transfers;
- keeps all of Plan 1's IST, cutoff, join and leave rules.

The app mirrors the new rules in `previewDay`, adds `pairTotals` for "who owes
whom", and updates its screens.

**Tech Stack:** as in Plans 1 and 2 (Supabase Postgres + PGlite/Vitest tests;
Expo SDK 57 app).

**Spec:** `docs/superpowers/specs/2026-10-10-steppool-design.md`, §3 and §4
(revised 2026-10-11).

## Global Constraints

- Shell: run from `~/Desktop/step-pool` after `source ~/.nvm/nvm.sh && nvm use >/dev/null`.
- Stake: per member, 1–1,000. Create, join and `set_my_stake` all write the row **effective tomorrow**.
- Goal: per group, 1,000–100,000, and changes take effect tomorrow.
- Payout: each loser L pays each winner V `floor(stake_L × stake_V / Σ winners' stakes)`. Zero amounts are skipped. Nothing moves if there are no winners or no losers. Rounding stays with the loser.
- No wallet: totals = `sum(day_results.coins_change)` and can be negative. No welcome coins, no top-ups.
- The migration wipes game data (groups, members, goals, stakes, steps, results, scored days). Profiles and accounts stay.
- Unchanged from Plans 1–2: IST, the 12 AM upload cutoff, join (plays from the next day), leave (takes effect tomorrow), RLS (members only, anon nothing), all writes through RPCs.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The remote `supabase db push` is run by the owner (it wipes data).

## Review Focus

1. **A tiny stake beats a big one:** a 1-coin winner alone takes a 500-coin loser's whole stake. This is pure proportional, as the owner chose. *(Task 1 test)*
2. **Stake change made today:** today is scored with the old stake, tomorrow with the new one. *(Task 1 test)*
3. **A member who joined today:** has no stake effective today and is not a participant; the app shows "plays from tomorrow" with their stake for tomorrow. *(Task 1 test + Task 3 api)*
4. **Overall "who owes whom" with payments both ways between a pair:** netted to a single direction. *(Task 2 test)*
5. **Rounding:** the loser keeps the remainder; the sum of transfers never exceeds the stake. *(Task 1 + Task 2 tests)*

---

### Task 1: Backend migration and SQL tests

**Files:**
- Create: `supabase/migrations/20261011000001_stakes.sql`
- Modify: `supabase/tests/helpers.ts`, `supabase/tests/schema.test.ts`, `supabase/tests/groups.test.ts`, `supabase/tests/scoring.test.ts`, `supabase/tests/read_access.test.ts`

**Interfaces:**
- Produces (authenticated only):
  - `create_group(p_name text, p_step_goal int, p_stake int) returns groups`
  - `join_group(p_invite_code text, p_stake int) returns groups`
  - `update_group_settings(p_group_id uuid, p_step_goal int) returns group_settings`
  - `set_my_stake(p_group_id uuid, p_stake int) returns void`
- Produces (tables and views):
  - tables `member_stakes(group_id, user_id, effective_from, stake)` and `day_transfers(group_id, day, from_user, to_user, amount)`
  - view `group_totals(group_id, user_id, total)`
  - `day_results.stake` (renamed from `daily_stake`)
- Errors: `22023` "Stake must be between 1 and 1,000 coins" and "Step goal must be between 1,000 and 100,000". The other errors are as in Plan 1.
- Test helpers: `helpers(db)` gains `newGroup(owner, members, { goal?, stake?, stakes?: Record<userId, number> })`, `join(userId, code, stake = 30)`, `total(groupId, userId)` and `transfers(groupId, day): Record<"from>to", number>`. `balance` is removed.

Steps (TDD):

- [ ] **Step 1:** Rewrite the four SQL test files and `helpers.ts` for the new rules. Cover:
  - **schema:** no coin ledger; direct writes refused on `member_stakes`/`day_transfers`.
  - **groups:** goal and stake rows; join with a stake; `update_group_settings(id, goal)`; `set_my_stake` from tomorrow, last change wins, and non-members and ex-members refused; validation.
  - **scoring:** proportional split; equal stakes; rounding left with the loser; the tiny-stake case; nothing moves when everyone or nobody missed; never-synced counts as 0; joiner; leaver; leave and re-join; goal change next day; stake change next day; not before midnight; idempotent; catch-up; permission; `group_totals`.
  - **read_access:** `group_totals`, `day_transfers` and `member_stakes` visible to members only; anon refused.
- [ ] **Step 2:** Run `npx vitest run supabase/tests`. Expected: FAIL (old RPC signatures, missing tables).
- [ ] **Step 3:** Write the migration (SQL in the file; follows the spec §3 algorithm exactly).
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: "Backend: per-person stakes, proportional transfers, no wallet, data reset".

### Task 2: App logic: proportional preview and who-owes-whom

**Files:**
- Modify: `src/lib/preview.ts`, `src/lib/preview.test.ts`, `src/lib/leaderboard.ts`, `src/lib/leaderboard.test.ts`

**Interfaces:**
- Produces:
  - `type PreviewMember = { userId; steps; stake }`
  - `type Transfer = { from: string; to: string; amount: number }`
  - `previewDay(goal, members): { transfers: Transfer[]; change: Record<string, number> }`, mirroring `score_group_day`
  - `pairTotals(transfers: Transfer[]): { debtor: string; creditor: string; amount: number }[]`, netted per pair, largest first, zeros omitted

Steps (TDD):
- [ ] **Step 1:** Write the failing tests:
  - preview: the spec example (20/40); equal stakes; rounding (16/33); the tiny stake; nothing moves.
  - pairTotals: payments in one direction; both directions netted; a pair that cancels out omitted.
- [ ] **Step 2:** Run them and see them FAIL.
- [ ] **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit.

### Task 3: Push the migration, regenerate types, update the data layer and screens

**Files:**
- Modify: `src/lib/database.types.ts` (regenerated), `src/lib/api.ts`, `src/app/index.tsx`, `src/app/create.tsx`, `src/app/join.tsx`, `src/app/group/[id]/index.tsx`, `src/app/group/[id]/history.tsx`, `src/app/group/[id]/settings.tsx`

**Interfaces:**
- Produces (api.ts):
  - `type MemberToday = { userId; name; avatarUrl; steps; syncedAt; stake: number; stakeTomorrow: number | null; total: number; playsToday; leavingAfterToday }`
  - `type GroupToday = { group; today: { stepGoal }; tomorrow: { stepGoal } | null; members }`
  - `getMyTotal(userId): Promise<number>`
  - `getHistory(groupId): Promise<{ results: HistoryRow[]; transfers: (Transfer & { day: string })[] }>`
  - `createGroup(name, stepGoal, stake)`, `joinGroup(code, stake)`, `updateGroupGoal(groupId, stepGoal)`, `setMyStake(groupId, stake)`

Steps:
- [ ] **Step 1:** Dry-run the push with `npx supabase db push --dry-run`. Expected: only `20261011000001_stakes.sql`. Then **the owner runs `npx supabase db push`**, because it wipes the remote game data.
- [ ] **Step 2:** `npx supabase gen types typescript --linked --schema public > src/lib/database.types.ts`
- [ ] **Step 3:** Update `api.ts` and the screens:
  - **Home:** your total.
  - **Create/Join:** ask for your stake.
  - **Today:** your stake, each member's stake, and the payments if the day ended now.
  - **Settings:** goal and your stake, each saved for tomorrow.
  - **History:** leaderboard, the Overall who-owes-whom card, and each day's payments.
- [ ] **Step 4:** `npm run typecheck && npm test`, plus `npx expo export` for both platforms. Expected: all green, both bundles.
- [ ] **Step 5:** Commit.

### Task 4: README and APK

- [ ] **Step 1:** Update the README's rules summary (per-person stakes, proportional payouts, no wallet).
- [ ] **Step 2:** Prebuild Android and run `./gradlew assembleRelease`. Copy the APK to `~/Desktop/StepPool.apk`, and check the bundle strings (`set_my_stake`, `day_transfers`).
- [ ] **Step 3:** Commit.
