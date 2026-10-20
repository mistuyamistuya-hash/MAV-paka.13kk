create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 24),
  role text not null default 'membre' check (role in ('general', 'chef', 'sous-chef', 'membre')),
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_nickname_lower_unique
  on public.profiles (lower(nickname));

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('general', 'chefs')),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists messages_channel_created_at_idx
  on public.messages (channel, created_at);

create or replace function public.create_vortex_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_nickname text;
begin
  requested_nickname := left(trim(coalesce(new.raw_user_meta_data ->> 'nickname', '')), 24);
  if requested_nickname = '' then
    requested_nickname := 'Membre-' || left(new.id::text, 8);
  end if;

  insert into public.profiles (id, nickname, role)
  values (new.id, requested_nickname, 'membre');
  return new;
end;
$$;

create trigger on_vortex_user_created
  after insert on auth.users
  for each row execute function public.create_vortex_profile();

create or replace function public.protect_vortex_profile_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and (new.id <> old.id or new.role <> old.role) then
    raise exception 'Les membres ne peuvent pas modifier leur rôle.';
  end if;
  return new;
end;
$$;

create trigger protect_vortex_profile_role
  before update on public.profiles
  for each row execute function public.protect_vortex_profile_role();

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

create policy "Authenticated users can read profiles"
  on public.profiles for select to authenticated using (true);

create policy "Users can update their own nickname"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Members can read general chat"
  on public.messages for select to authenticated
  using (
    channel = 'general'
    or (
      channel = 'chefs'
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid())
          and p.role in ('chef', 'general')
      )
    )
  );

create policy "Members can send to permitted chats"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (
      channel = 'general'
      or (
        channel = 'chefs'
        and exists (
          select 1 from public.profiles p
          where p.id = (select auth.uid())
            and p.role in ('chef', 'general')
        )
      )
    )
  );

grant select, update on public.profiles to authenticated;
grant select, insert on public.messages to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
