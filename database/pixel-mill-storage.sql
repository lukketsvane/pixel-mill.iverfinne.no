create table public.pixel_mill_objects (
  key text primary key check (length(key) between 1 and 300),
  body text,
  etag uuid not null default gen_random_uuid(),
  removed boolean not null default false,
  updated_at timestamptz not null default now(),
  check (body is null or octet_length(body) <= 33554432)
);
create table public.pixel_mill_storage_credentials (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true
);
alter table public.pixel_mill_objects enable row level security;
alter table public.pixel_mill_storage_credentials enable row level security;
revoke all on public.pixel_mill_objects, public.pixel_mill_storage_credentials from public, anon, authenticated;
grant select, insert, update, delete on public.pixel_mill_objects to service_role;
grant select on public.pixel_mill_storage_credentials to service_role;

create function public.pixel_mill_storage(p_token_hash text, p_operation text, p_key text,
  p_body text default null, p_etag text default null, p_create_only boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item public.pixel_mill_objects;
  next_etag uuid;
begin
  if not exists (select 1 from public.pixel_mill_storage_credentials where token_hash = p_token_hash and enabled) then
    raise exception 'Invalid storage credential' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^((projects/)?(v2/)?rooms/[a-f0-9]{64}(/(preview|deleted/[a-f0-9]{64}))?|chat-usage/[0-9]{4}-[0-9]{2}-[0-9]{2})$' then
    return jsonb_build_object('status', 400);
  end if;
  if p_operation = 'get' then
    select * into item from public.pixel_mill_objects where key = p_key;
    if not found then return jsonb_build_object('status', 404); end if;
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
    insert into public.pixel_mill_objects(key, body, removed) values (p_key, null, true)
    on conflict (key) do update set body = null, removed = true, etag = gen_random_uuid(), updated_at = now();
    return jsonb_build_object('status', 200);
  end if;
  return jsonb_build_object('status', 400);
end;
$$;
revoke all on function public.pixel_mill_storage(text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.pixel_mill_storage(text, text, text, text, text, boolean) to service_role;
