-- Read access: members see their groups and the people in them. Nothing else.
-- Signed-out visitors (anon) can read nothing.

-- Membership counts while it is active (a leave takes effect the next day).
create function public.is_group_member(p_group_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_active_member(p_group_id, auth.uid())
$$;

create function public.shares_group_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select p_user_id = auth.uid() or exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user_id
      and public.is_active_member(mine.group_id, mine.user_id)
      and public.is_active_member(theirs.group_id, theirs.user_id)
  )
$$;

-- People who left still appear in a group's history, so their names stay readable there.
create function public.appears_in_my_groups(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.day_results dr
    join public.group_members mine on mine.group_id = dr.group_id
    where dr.user_id = p_user_id and mine.user_id = auth.uid()
      and public.is_active_member(mine.group_id, mine.user_id)
  )
$$;

revoke execute on function public.is_group_member(uuid) from public, anon;
revoke execute on function public.shares_group_with(uuid) from public, anon;
revoke execute on function public.appears_in_my_groups(uuid) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;
grant execute on function public.appears_in_my_groups(uuid) to authenticated;

create policy "members read their groups" on public.groups
  for select to authenticated using (public.is_group_member(id));
create policy "members read group settings" on public.group_settings
  for select to authenticated using (public.is_group_member(group_id));
create policy "members read group members" on public.group_members
  for select to authenticated using (public.is_group_member(group_id));
create policy "members read day results" on public.day_results
  for select to authenticated using (public.is_group_member(group_id));
create policy "read profiles of people you share a group with" on public.profiles
  for select to authenticated
  using (public.shares_group_with(id) or public.appears_in_my_groups(id));
create policy "read steps of people you share a group with" on public.daily_steps
  for select to authenticated using (public.shares_group_with(user_id));
create policy "read coins of people you share a group with" on public.coin_ledger
  for select to authenticated using (public.shares_group_with(user_id));

-- Coin balance per person, visible wherever their ledger rows are visible.
create view public.balances with (security_invoker = true) as
  select user_id, sum(amount)::int as balance
  from public.coin_ledger
  group by user_id;

revoke insert, update, delete, truncate on public.balances from authenticated;
grant select on public.balances to authenticated;

revoke all on all tables in schema public from anon;
