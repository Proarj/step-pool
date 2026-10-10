# StepPool

A private step challenge for one group of friends. Everyone stakes the same
number of virtual coins each day, and whoever misses the group's step goal
loses their stake to the people who hit it. Design:
`docs/superpowers/specs/2026-10-10-steppool-design.md`.

## Requirements

- Node 24 (`nvm use` picks it up from `.nvmrc`)

## Tests

```bash
nvm use
npm test          # SQL tests run the real migrations in PGlite: no Docker, no accounts
npm run typecheck
```

## Database

All backend logic is in `supabase/migrations/`:

| File | What it does |
|---|---|
| `…01_schema.sql` | Tables, IST clock helpers, sign-up trigger (+1,000 coins), write lockdown |
| `…02_groups.sql` | `create_group`, `join_group`, `update_group_settings` (from tomorrow), `leave_group` |
| `…03_steps.sql` | `upload_steps`: only for today in IST |
| `…04_scoring.sql` | `score_pending_days`: settles every unscored day before today |
| `…05_read_access.sql` | Row Level Security: members see their group and its people only |
| `…06_cron.sql` | Runs scoring every hour on the hour IST (Supabase only) |

Apply them to a Supabase project:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```
