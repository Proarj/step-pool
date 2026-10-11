-- Rules update 2026-10-11 (owner: "if you leave you leave"): leaving takes
-- effect immediately. The group disappears for the leaver at once and they sit
-- out that day. Re-joining is a fresh join that plays from the next day. The
-- owner accepted that someone could leave and re-join to skip a bad day.

-- Fresh start, as the owner asked: wipe all game data. Accounts and profiles stay.
truncate table public.day_transfers, public.day_results, public.scored_days, public.daily_steps,
  public.member_stakes, public.group_members, public.group_settings, public.groups;

-- Joining and leaving on the same day is now possible (left_on = joined_on).
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.group_members'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%left_on%'
  loop
    execute format('alter table public.group_members drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.group_members add constraint group_members_left_on_check check (left_on >= joined_on);

-- left_on = today: is_active_member() is false at once, and scoring (left_on > D)
-- leaves them out of today.
create or replace function public.leave_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
begin
  update public.group_members
  set left_on = public.app_today()
  where group_id = p_group_id and user_id = v_user and left_on is null;
end;
$$;
