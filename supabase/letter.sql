-- 在 Supabase SQL Editor 中执行一次。表和 RPC 仅供服务端 service_role 使用。
create table if not exists public.letter_records (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('comment','memory','attachment')),
  owner text not null default '',
  text text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists letter_feed on public.letter_records(kind,created_at desc,id desc);
create table if not exists public.letter_limits (
  key text primary key,
  start timestamptz not null,
  count integer not null
);
alter table public.letter_records enable row level security;
alter table public.letter_limits enable row level security;
revoke all on public.letter_records,public.letter_limits from anon,authenticated;
grant all on public.letter_records,public.letter_limits to service_role;

create or replace function public.letter_rate_limit(p_key text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare attempts integer;
begin
  insert into letter_limits(key,start,count) values(p_key,now(),1)
  on conflict(key) do update set
    count=case when letter_limits.start < now()-make_interval(secs=>p_seconds) then 1 else letter_limits.count+1 end,
    start=case when letter_limits.start < now()-make_interval(secs=>p_seconds) then now() else letter_limits.start end
  returning count into attempts;
  if attempts=1 then delete from letter_limits where start < now()-interval '1 day'; end if;
  return attempts<=p_limit;
end $$;

-- 兼容已经上线的旧版函数：重跑本脚本更新接口，不改动历史留言。
drop function if exists public.letter_create_comment(text,text,uuid[]);
create or replace function public.letter_create_comment(p_owner text,p_text text,p_images uuid[],p_author jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare image_count integer; result letter_records%rowtype;
begin
  if char_length(p_text)>2000 or cardinality(p_images)>30 or (length(trim(p_text))=0 and cardinality(p_images)=0) then
    raise exception '留言内容无效';
  end if;
  perform id from letter_records where id=any(p_images) order by id for update;
  select count(*) into image_count from letter_records
    where id=any(p_images) and kind='attachment' and owner=p_owner and not coalesce((data->>'attached')::boolean,false);
  if image_count<>cardinality(p_images) then raise exception '图片无效，请重新添加。'; end if;
  insert into letter_records(kind,owner,text,data)
    values('comment',p_owner,p_text,jsonb_build_object('imageIds',to_jsonb(p_images),'author',p_author)) returning * into result;
  update letter_records set data=data||'{"attached":true}'::jsonb where id=any(p_images);
  return to_jsonb(result);
end $$;

create or replace function public.letter_delete_comment(p_author_id text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target letter_records%rowtype; image_keys jsonb;
begin
  select * into target from letter_records where id=p_id and kind='comment' for update;
  if not found then raise exception '留言不存在'; end if;
  if coalesce(target.data->'author'->>'id','tanxiao')<>p_author_id then raise exception '只能删除自己的留言'; end if;
  perform id from letter_records where kind='attachment' and id in (
    select value::uuid from jsonb_array_elements_text(coalesce(target.data->'imageIds','[]'::jsonb))
  ) order by id for update;
  select coalesce(jsonb_agg(data->>'key'),'[]'::jsonb) into image_keys from letter_records
    where kind='attachment' and owner=target.owner and coalesce((data->>'attached')::boolean,false) and id in (
      select value::uuid from jsonb_array_elements_text(coalesce(target.data->'imageIds','[]'::jsonb))
    );
  delete from letter_records where kind='attachment' and owner=target.owner and coalesce((data->>'attached')::boolean,false) and id in (
    select value::uuid from jsonb_array_elements_text(coalesce(target.data->'imageIds','[]'::jsonb))
  );
  delete from letter_records where id=p_id;
  return image_keys;
end $$;

revoke all on function public.letter_rate_limit(text,integer,integer) from public,anon,authenticated;
revoke all on function public.letter_create_comment(text,text,uuid[],jsonb) from public,anon,authenticated;
revoke all on function public.letter_delete_comment(text,uuid) from public,anon,authenticated;
grant execute on function public.letter_rate_limit(text,integer,integer) to service_role;
grant execute on function public.letter_create_comment(text,text,uuid[],jsonb) to service_role;
grant execute on function public.letter_delete_comment(text,uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('letter-images','letter-images',false,1572864,array['image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
