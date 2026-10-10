-- StepPool schema: time helpers, tables, the sign-up trigger, and lockdown.
-- The app never writes tables directly; later migrations add the functions it calls.

-- Clock. The test harness replaces app_now() to control time; production uses now().
create function public.app_now() returns timestamptz
language sql stable
as $$ select now() $$;

-- Today's date in IST, the only time zone StepPool supports in v1.
create function public.app_today() returns date
language sql stable
as $$ select (public.app_now() at time zone 'Asia/Kolkata')::date $$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique check (invite_code ~ '^[A-Z2-9]{6}$'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null
);

create table public.group_settings (
  group_id uuid not null references public.groups (id) on delete cascade,
  effective_from date not null,
  step_goal int not null check (step_goal between 1000 and 100000),
  daily_stake int not null check (daily_stake between 1 and 1000),
  primary key (group_id, effective_from)
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_on date not null,
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create table public.daily_steps (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  steps int not null check (steps between 0 and 100000),
  source text not null check (source in ('apple_health', 'health_connect')),
  synced_at timestamptz not null,
  primary key (user_id, day)
);

create table public.coin_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  day date,
  amount int not null check (amount <> 0),
  reason text not null check (reason in ('welcome', 'won', 'lost', 'top_up')),
  created_at timestamptz not null default now()
);
create index coin_ledger_user_idx on public.coin_ledger (user_id);

create table public.day_results (
  group_id uuid not null references public.groups (id) on delete cascade,
  day date not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  steps int not null,
  step_goal int not null,
  daily_stake int not null,
  hit boolean not null,
  coins_change int not null,
  primary key (group_id, day, user_id)
);

create table public.scored_days (
  group_id uuid not null references public.groups (id) on delete cascade,
  day date not null,
  scored_at timestamptz not null,
  primary key (group_id, day)
);

-- Sign-up: every new auth user gets a profile and 1,000 welcome coins.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Player'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  insert into public.coin_ledger (user_id, amount, reason, created_at)
  values (new.id, 1000, 'welcome', public.app_now());
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lockdown: reads are opened table by table with RLS policies (a later
-- migration); writes only ever happen inside security-definer functions.
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_settings enable row level security;
alter table public.group_members enable row level security;
alter table public.daily_steps enable row level security;
alter table public.coin_ledger enable row level security;
alter table public.day_results enable row level security;
alter table public.scored_days enable row level security;

revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
