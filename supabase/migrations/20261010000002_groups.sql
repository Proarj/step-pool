-- Groups: create, join by invite code, change goal/stake (from tomorrow), leave.

-- The signed-in caller's id, or an error if signed out.
create function public.require_user() returns uuid
language plpgsql stable
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

create function public.assert_valid_settings(p_step_goal int, p_daily_stake int) returns void
language plpgsql immutable
as $$
begin
  if p_step_goal is null or p_step_goal < 1000 or p_step_goal > 100000 then
    raise exception 'Step goal must be between 1,000 and 100,000' using errcode = '22023';
  end if;
  if p_daily_stake is null or p_daily_stake < 1 or p_daily_stake > 1000 then
    raise exception 'Daily stake must be between 1 and 1,000 coins' using errcode = '22023';
  end if;
end;
$$;

-- Six characters without look-alikes (no I, O, 0, 1).
create function public.generate_invite_code() returns text
language plpgsql volatile set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups where invite_code = code);
  end loop;
  return code;
end;
$$;

create function public.create_group(p_name text, p_step_goal int, p_daily_stake int)
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
  perform public.assert_valid_settings(p_step_goal, p_daily_stake);

  insert into public.groups (name, invite_code, created_by, created_at)
  values (v_name, public.generate_invite_code(), v_user, public.app_now())
  returning * into v_group;

  insert into public.group_settings (group_id, effective_from, step_goal, daily_stake)
  values (v_group.id, public.app_today(), p_step_goal, p_daily_stake);

  insert into public.group_members (group_id, user_id, joined_on)
  values (v_group.id, v_user, public.app_today());

  return v_group;
end;
$$;

create function public.join_group(p_invite_code text)
returns public.groups
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_group public.groups;
begin
  select * into v_group
  from public.groups
  where invite_code = upper(regexp_replace(coalesce(p_invite_code, ''), '\s', '', 'g'));
  if not found then
    raise exception 'No group with that invite code' using errcode = 'P0002';
  end if;

  insert into public.group_members (group_id, user_id, joined_on)
  values (v_group.id, v_user, public.app_today())
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

-- Changes always start tomorrow, so nobody can change today's rules after seeing the steps.
create function public.update_group_settings(p_group_id uuid, p_step_goal int, p_daily_stake int)
returns public.group_settings
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.group_settings;
begin
  if not exists (
    select 1 from public.group_members where group_id = p_group_id and user_id = v_user
  ) then
    raise exception 'You are not a member of this group' using errcode = '42501';
  end if;
  perform public.assert_valid_settings(p_step_goal, p_daily_stake);

  insert into public.group_settings (group_id, effective_from, step_goal, daily_stake)
  values (p_group_id, public.app_today() + 1, p_step_goal, p_daily_stake)
  on conflict (group_id, effective_from) do update
    set step_goal = excluded.step_goal, daily_stake = excluded.daily_stake
  returning * into v_row;

  return v_row;
end;
$$;

create function public.leave_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
begin
  delete from public.group_members where group_id = p_group_id and user_id = v_user;
end;
$$;

revoke execute on function public.require_user() from public, anon, authenticated;
revoke execute on function public.assert_valid_settings(int, int) from public, anon, authenticated;
revoke execute on function public.generate_invite_code() from public, anon, authenticated;

revoke execute on function public.create_group(text, int, int) from public, anon;
revoke execute on function public.join_group(text) from public, anon;
revoke execute on function public.update_group_settings(uuid, int, int) from public, anon;
revoke execute on function public.leave_group(uuid) from public, anon;
grant execute on function public.create_group(text, int, int) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.update_group_settings(uuid, int, int) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
