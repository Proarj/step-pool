-- Scoring: at 12:00 AM IST (and hourly as catch-up) every unscored day before
-- today is settled. Rules (spec §3): losers lose min(stake, balance); winners
-- split the pot equally in whole coins and any remainder disappears; with no
-- winners or no losers nothing moves; an empty wallet is topped up to 200.

create function public.balance_of(p_user_id uuid) returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(amount), 0)::int from public.coin_ledger where user_id = p_user_id
$$;

-- Who plays on p_day: members who joined before that day and had not left by it.
create function public.group_day_participants(p_group_id uuid, p_day date, p_goal int)
returns table (user_id uuid, steps int, hit boolean)
language sql stable security definer set search_path = public
as $$
  select m.user_id,
         coalesce(s.steps, 0) as steps,
         coalesce(s.steps, 0) >= p_goal as hit
  from public.group_members m
  left join public.daily_steps s on s.user_id = m.user_id and s.day = p_day
  where m.group_id = p_group_id
    and m.joined_on < p_day
    and (m.left_on is null or m.left_on > p_day)
  order by m.user_id
$$;

create function public.score_group_day(p_group_id uuid, p_day date) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_goal int;
  v_stake int;
  v_participants int;
  v_winners int;
  v_pot int := 0;
  v_share int;
  v_loss int;
  p record;
begin
  -- Claim the day first; a day that is already scored is never touched again.
  insert into public.scored_days (group_id, day, scored_at)
  values (p_group_id, p_day, public.app_now())
  on conflict do nothing;
  if not found then
    return;
  end if;

  select gs.step_goal, gs.daily_stake into v_goal, v_stake
  from public.group_settings gs
  where gs.group_id = p_group_id and gs.effective_from <= p_day
  order by gs.effective_from desc
  limit 1;
  if v_goal is null then
    return;
  end if;

  select count(*), count(*) filter (where gp.hit)
  into v_participants, v_winners
  from public.group_day_participants(p_group_id, p_day, v_goal) gp;
  if v_participants = 0 then
    return;
  end if;

  -- Nobody to pay out to, or nobody who lost: record the day, move nothing.
  if v_winners = 0 or v_winners = v_participants then
    insert into public.day_results (group_id, day, user_id, steps, step_goal, daily_stake, hit, coins_change)
    select p_group_id, p_day, gp.user_id, gp.steps, v_goal, v_stake, gp.hit, 0
    from public.group_day_participants(p_group_id, p_day, v_goal) gp;
    return;
  end if;

  for p in
    select * from public.group_day_participants(p_group_id, p_day, v_goal) gp where not gp.hit
  loop
    v_loss := least(v_stake, public.balance_of(p.user_id));
    if v_loss > 0 then
      insert into public.coin_ledger (user_id, group_id, day, amount, reason, created_at)
      values (p.user_id, p_group_id, p_day, -v_loss, 'lost', public.app_now());
    end if;
    v_pot := v_pot + v_loss;
    insert into public.day_results (group_id, day, user_id, steps, step_goal, daily_stake, hit, coins_change)
    values (p_group_id, p_day, p.user_id, p.steps, v_goal, v_stake, false, -v_loss);
  end loop;

  v_share := v_pot / v_winners; -- integer division: the remainder disappears
  for p in
    select * from public.group_day_participants(p_group_id, p_day, v_goal) gp where gp.hit
  loop
    if v_share > 0 then
      insert into public.coin_ledger (user_id, group_id, day, amount, reason, created_at)
      values (p.user_id, p_group_id, p_day, v_share, 'won', public.app_now());
    end if;
    insert into public.day_results (group_id, day, user_id, steps, step_goal, daily_stake, hit, coins_change)
    values (p_group_id, p_day, p.user_id, p.steps, v_goal, v_stake, true, v_share);
  end loop;

  insert into public.coin_ledger (user_id, group_id, day, amount, reason, created_at)
  select gp.user_id, p_group_id, p_day, 200, 'top_up', public.app_now()
  from public.group_day_participants(p_group_id, p_day, v_goal) gp
  where public.balance_of(gp.user_id) <= 0;
end;
$$;

create function public.score_pending_days() returns int
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select g.id as group_id, d::date as day
    from public.groups g
    cross join lateral generate_series(
      (g.created_at at time zone 'Asia/Kolkata')::date::timestamp,
      (public.app_today() - 1)::timestamp,
      interval '1 day'
    ) as d
    where not exists (
      select 1 from public.scored_days sd where sd.group_id = g.id and sd.day = d::date
    )
    order by d, g.created_at, g.id
  loop
    perform public.score_group_day(r.group_id, r.day);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.balance_of(uuid) from public, anon, authenticated;
revoke execute on function public.group_day_participants(uuid, date, int) from public, anon, authenticated;
revoke execute on function public.score_group_day(uuid, date) from public, anon, authenticated;
revoke execute on function public.score_pending_days() from public, anon, authenticated;
