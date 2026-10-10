create index if not exists pixel_mill_transfers_updated_at on public.pixel_mill_objects(updated_at) where key like 'transfers/%';

create or replace function public.pixel_mill_storage(p_token_hash text, p_operation text, p_key text,
  p_body text default null, p_etag text default null, p_create_only boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item public.pixel_mill_objects;
  next_etag uuid;
begin
  if not exists (select 1 from public.pixel_mill_storage_credentials where token_hash = p_token_hash and enabled) then
    raise exception 'Invalid storage credential' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^((projects/)?(v2/)?rooms/[a-f0-9]{64}(/(preview|deleted/[a-f0-9]{64}))?|chat-usage/[0-9]{4}-[0-9]{2}-[0-9]{2}|transfers/[a-f0-9]{64}/(0|[1-9]|[12][0-9]|3[01]))$' then
    return jsonb_build_object('status', 400);
  end if;
  if p_operation = 'put' and p_key like 'transfers/%' then
    delete from public.pixel_mill_objects where key like 'transfers/%' and updated_at < now() - interval '30 minutes';
  end if;
  if p_operation = 'get' then
    select * into item from public.pixel_mill_objects where key = p_key;
    if not found then return jsonb_build_object('status', 404); end if;
    if p_key like 'transfers/%' and item.updated_at < now() - interval '30 minutes' then return jsonb_build_object('status', 404); end if;
    if item.removed then return jsonb_build_object('status', 410); end if;
    if item.etag::text = p_etag then return jsonb_build_object('status', 304, 'etag', item.etag); end if;
    return jsonb_build_object('status', 200, 'etag', item.etag, 'body', item.body);
  elsif p_operation = 'put' then
    if p_body is null or octet_length(p_body) > 33554432 then return jsonb_build_object('status', 413); end if;
    if p_etag is not null then
      update public.pixel_mill_objects set body = p_body, etag = gen_random_uuid(), updated_at = now()
      where key = p_key and etag::text = p_etag and not removed returning etag into next_etag;
    elsif p_create_only then
      insert into public.pixel_mill_objects(key, body) values (p_key, p_body)
      on conflict (key) do nothing returning etag into next_etag;
    else
      insert into public.pixel_mill_objects(key, body) values (p_key, p_body)
      on conflict (key) do update set body = excluded.body, etag = gen_random_uuid(), removed = false, updated_at = now()
      returning etag into next_etag;
    end if;
    if next_etag is null then return jsonb_build_object('status', 412); end if;
    return jsonb_build_object('status', 200, 'etag', next_etag);
  elsif p_operation = 'delete' then
    if p_key like 'transfers/%' then
      delete from public.pixel_mill_objects where key = p_key;
      return jsonb_build_object('status', 200);
    end if;
    insert into public.pixel_mill_objects(key, body, removed) values (p_key, null, true)
    on conflict (key) do update set body = null, removed = true, etag = gen_random_uuid(), updated_at = now();
    return jsonb_build_object('status', 200);
  end if;
  return jsonb_build_object('status', 400);
end;
$$;
revoke all on function public.pixel_mill_storage(text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.pixel_mill_storage(text, text, text, text, text, boolean) to service_role;
