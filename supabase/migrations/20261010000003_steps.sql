-- Step uploads: a person can only set their own total, and only for today (IST).
-- At 12:00 AM IST yesterday closes for good.

create function public.upload_steps(p_day date, p_steps int, p_source text)
returns public.daily_steps
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := public.require_user();
  v_row public.daily_steps;
begin
  if p_day is distinct from public.app_today() then
    raise exception 'Steps can only be uploaded for today (%)', public.app_today()
      using errcode = '22023';
  end if;
  if p_steps is null or p_steps < 0 or p_steps > 100000 then
    raise exception 'Steps must be between 0 and 100000' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('apple_health', 'health_connect') then
    raise exception 'Unknown step source: %', p_source using errcode = '22023';
  end if;

  insert into public.daily_steps (user_id, day, steps, source, synced_at)
  values (v_user, p_day, p_steps, p_source, public.app_now())
  on conflict (user_id, day) do update
    set steps = excluded.steps, source = excluded.source, synced_at = excluded.synced_at
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.upload_steps(date, int, text) from public, anon;
grant execute on function public.upload_steps(date, int, text) to authenticated;
