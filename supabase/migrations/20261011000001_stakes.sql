-- Rules update 2026-10-11 (spec §3): every member sets their own stake, losers
-- pay winners in proportion to the winners' stakes, and there is no wallet:
-- totals start at 0 and can go negative.

-- Fresh start: wipe all game data. Accounts and profiles stay.
truncate table public.day_results, public.scored_days, public.daily_steps,
  public.group_members, public.group_settings, public.coin_ledger, public.groups;

-- No wallet: the coin ledger, balances, welcome coins and top-ups go away.
drop view public.balances;
drop function public.balance_of(uuid);
drop table public.coin_ledger;

create or replace function public.handle_new_user() returns trigger
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
  return new;
end;
$$;

-- One goal per group; stakes are per member.
alter table public.group_settings drop column daily_stake;
alter table public.day_results rename column daily_stake to stake;

create table public.member_stakes (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  effective_from date not null,
  stake int not null check (stake between 1 and 1000),
  primary key (group_id, user_id, effective_from)
);

-- Who paid whom on a scored day.
create table public.day_transfers (
  group_id uuid not null references public.groups (id) on delete cascade,
  day date not null,
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  amount int not null check (amount > 0),
  primary key (group_id, day, from_user, to_user)
);

alter table public.member_stakes enable row level security;
alter table public.day_transfers enable row level security;
revoke all on public.member_stakes, public.day_transfers from anon;
revoke insert, update, delete, truncate on public.member_stakes, public.day_transfers from authenticated;
create policy "members read stakes" on public.member_stakes
  for select to authenticated using (public.is_group_member(group_id));
create policy "members read payments" on public.day_transfers
  for select to authenticated using (public.is_group_member(group_id));

-- Each person's running total per group.
create view public.group_totals with (security_invoker = true) as
  select group_id, user_id, sum(coins_change)::int as total
  from public.day_results
  group by group_id, user_id;
revoke all on public.group_totals from anon;
revoke insert, update, delete, truncate on public.group_totals from authenticated;
grant select on public.group_totals to authenticated;

-- Validation.
drop function public.assert_valid_settings(int, int);

create function public.assert_valid_goal(p_step_goal int) returns void
language plpgsql immutable
as $$
begin
  if p_step_goal is null or p_step_goal < 1000 or p_step_goal > 100000 then
    raise exception 'Step goal must be between 1,000 and 100,000' using errcode = '22023';
  end if;
end;
$$;

create function public.assert_valid_stake(p_stake int) returns void
language plpgsql immutable
as $$
begin
  if p_stake is null or p_stake < 1 or p_stake > 1000 then
    raise exception 'Stake must be between 1 and 1,000 coins' using errcode = '22023';
  end if;
end;
$$;

-- Stakes always start tomorrow (on joining you play from tomorrow anyway).
create function public.put_stake_from_tomorrow(p_group_id uuid, p_user_id uuid, p_stake int) returns void
language sql security definer set search_path = public
as $$
  insert into public.member_stakes (group_id, user_id, effective_from, stake)
  values (p_group_id, p_user_id, public.app_today() + 1, p_stake)
  on conflict (group_id, user_id, effective_from) do update set stake = excluded.stake
$$;

drop function public.create_group(text, int, int);
create function public.create_group(p_name text, p_step_goal int, p_stake int)
returns public.groups
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_name text := trim(coalesce(p_name, ''));
  v_group public.groups;
begin
  if char_length(v_name) not between 1 and 40 then
    raise exception 'Group name must be 1 to 40 characters' using errcode = '22023';
  end if;
  perform public.assert_valid_goal(p_step_goal);
  perform public.assert_valid_stake(p_stake);

  insert into public.groups (name, invite_code, created_by, created_at)
  values (v_name, public.generate_invite_code(), v_user, public.app_now())
  returning * into v_group;

  insert into public.group_settings (group_id, effective_from, step_goal)
  values (v_group.id, public.app_today(), p_step_goal);

  insert into public.group_members (group_id, user_id, joined_on)
  values (v_group.id, v_user, public.app_today());

  perform public.put_stake_from_tomorrow(v_group.id, v_user, p_stake);
  return v_group;
end;
$$;

drop function public.join_group(text);
create function public.join_group(p_invite_code text, p_stake int)
returns public.groups
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_group public.groups;
begin
  perform public.assert_valid_stake(p_stake);
  select * into v_group
  from public.groups
  where invite_code = upper(regexp_replace(coalesce(p_invite_code, ''), '\s', '', 'g'));
  if not found then
    raise exception 'No group with that invite code' using errcode = 'P0002';
  end if;

  -- Re-joining cancels a pending leave. Once a leave has taken effect, it is a
  -- fresh join and the person plays again from tomorrow.
  insert into public.group_members as gm (group_id, user_id, joined_on)
  values (v_group.id, v_user, public.app_today())
  on conflict (group_id, user_id) do update
    set joined_on = case when gm.left_on <= public.app_today() then excluded.joined_on else gm.joined_on end,
        left_on = null;

  perform public.put_stake_from_tomorrow(v_group.id, v_user, p_stake);
  return v_group;
end;
$$;

drop function public.update_group_settings(uuid, int, int);
create function public.update_group_settings(p_group_id uuid, p_step_goal int)
returns public.group_settings
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.group_settings;
begin
  if not public.is_active_member(p_group_id, v_user) then
    raise exception 'You are not a member of this group' using errcode = '42501';
  end if;
  perform public.assert_valid_goal(p_step_goal);

  insert into public.group_settings (group_id, effective_from, step_goal)
  values (p_group_id, public.app_today() + 1, p_step_goal)
  on conflict (group_id, effective_from) do update set step_goal = excluded.step_goal
  returning * into v_row;

  return v_row;
end;
$$;

create function public.set_my_stake(p_group_id uuid, p_stake int) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
begin
  if not public.is_active_member(p_group_id, v_user) then
    raise exception 'You are not a member of this group' using errcode = '42501';
  end if;
  perform public.assert_valid_stake(p_stake);
  perform public.put_stake_from_tomorrow(p_group_id, v_user, p_stake);
end;
$$;

-- Who plays on p_day, with the stake in force that day.
drop function public.group_day_participants(uuid, date, int);
create function public.group_day_participants(p_group_id uuid, p_day date, p_goal int)
returns table (user_id uuid, steps int, hit boolean, stake int)
language sql stable security definer set search_path = public
as $$
  select m.user_id,
         coalesce(s.steps, 0) as steps,
         coalesce(s.steps, 0) >= p_goal as hit,
         st.stake
  from public.group_members m
  join lateral (
    select ms.stake from public.member_stakes ms
    where ms.group_id = m.group_id and ms.user_id = m.user_id and ms.effective_from <= p_day
    order by ms.effective_from desc
    limit 1
  ) st on true
  left join public.daily_steps s on s.user_id = m.user_id and s.day = p_day
  where m.group_id = p_group_id
    and m.joined_on < p_day
    and (m.left_on is null or m.left_on > p_day)
  order by m.user_id
$$;

-- Spec §3: each loser pays each winner floor(loser stake × winner stake / total
-- winner stake); rounding stays with the loser; no winners or no losers → nothing.
create or replace function public.score_group_day(p_group_id uuid, p_day date) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_goal int;
  v_participants int;
  v_winners int;
  v_winner_stake int;
begin
  -- Claim the day first; a day that is already scored is never touched again.
  insert into public.scored_days (group_id, day, scored_at)
  values (p_group_id, p_day, public.app_now())
  on conflict do nothing;
  if not found then
    return;
  end if;

  select gs.step_goal into v_goal
  from public.group_settings gs
  where gs.group_id = p_group_id and gs.effective_from <= p_day
  order by gs.effective_from desc
  limit 1;
  if v_goal is null then
    return;
  end if;

  select count(*), count(*) filter (where gp.hit), coalesce(sum(gp.stake) filter (where gp.hit), 0)
  into v_participants, v_winners, v_winner_stake
  from public.group_day_participants(p_group_id, p_day, v_goal) gp;
  if v_participants = 0 then
    return;
  end if;

  if v_winners > 0 and v_winners < v_participants then
    insert into public.day_transfers (group_id, day, from_user, to_user, amount)
    select p_group_id, p_day, l.user_id, w.user_id, (l.stake * w.stake) / v_winner_stake
    from public.group_day_participants(p_group_id, p_day, v_goal) l
    cross join public.group_day_participants(p_group_id, p_day, v_goal) w
    where not l.hit and w.hit and (l.stake * w.stake) / v_winner_stake > 0;
  end if;

  insert into public.day_results (group_id, day, user_id, steps, step_goal, stake, hit, coins_change)
  select p_group_id, p_day, gp.user_id, gp.steps, v_goal, gp.stake, gp.hit,
         (coalesce((select sum(t.amount) from public.day_transfers t
                    where t.group_id = p_group_id and t.day = p_day and t.to_user = gp.user_id), 0)
        - coalesce((select sum(t.amount) from public.day_transfers t
                    where t.group_id = p_group_id and t.day = p_day and t.from_user = gp.user_id), 0))::int
  from public.group_day_participants(p_group_id, p_day, v_goal) gp;
end;
$$;

revoke execute on function public.assert_valid_goal(int) from public, anon, authenticated;
revoke execute on function public.assert_valid_stake(int) from public, anon, authenticated;
revoke execute on function public.put_stake_from_tomorrow(uuid, uuid, int) from public, anon, authenticated;
revoke execute on function public.group_day_participants(uuid, date, int) from public, anon, authenticated;

revoke execute on function public.create_group(text, int, int) from public, anon;
revoke execute on function public.join_group(text, int) from public, anon;
revoke execute on function public.update_group_settings(uuid, int) from public, anon;
revoke execute on function public.set_my_stake(uuid, int) from public, anon;
grant execute on function public.create_group(text, int, int) to authenticated;
grant execute on function public.join_group(text, int) to authenticated;
grant execute on function public.update_group_settings(uuid, int) to authenticated;
grant execute on function public.set_my_stake(uuid, int) to authenticated;
