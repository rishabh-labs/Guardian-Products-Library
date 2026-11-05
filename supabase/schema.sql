-- Products Library — database, file storage and access rules.
-- Paste this whole file into Supabase → SQL Editor → New query, and press Run.
-- Safe to run again: it only creates what is missing and refreshes the rules.

------------------------------------------------------------------------------
-- 1. WHO IS ON THE TEAM
--    Anyone signed in with an email at TEAM DOMAIN below, plus any address
--    listed in team_access (for people outside the domain).
--    Admins (role = 'admin') can delete anyone's product, file or note.
------------------------------------------------------------------------------
create table if not exists public.team_access (
  email text primary key,
  role  text not null default 'member' check (role in ('member','admin'))
);
alter table public.team_access enable row level security;   -- no policies: only readable through the functions below

-- >>> EDIT HERE: your company email domain and the first admin <<<
create or replace function public.team_domain() returns text
language sql immutable as $$ select 'gcia.in' $$;

insert into public.team_access (email, role) values ('rishabh@gcia.in', 'admin')
on conflict (email) do update set role = excluded.role;
-- >>> end of edits <<<

create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    lower(coalesce(auth.jwt()->>'email','')) like '%@' || public.team_domain()
    or exists (select 1 from public.team_access where email = lower(auth.jwt()->>'email'))
  )
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.team_access where email = lower(auth.jwt()->>'email') and role = 'admin')
$$;

------------------------------------------------------------------------------
-- 2. TABLES
------------------------------------------------------------------------------
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 200),
  manager         text not null default '',
  category        text not null default 'Other',
  strategy        text not null default '',
  decision        text not null default 'review' check (decision in ('accepted','rejected','review')),
  decided_on      date,
  rationale       text not null default '' check (char_length(rationale) <= 20000),
  tags            text[] not null default '{}',
  links           jsonb not null default '[]'::jsonb,
  created_by      uuid default auth.uid(),
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_name text not null default '',
  updated_at      timestamptz not null default now()
);

create table if not exists public.documents (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products(id) on delete cascade,
  name             text not null,
  size             bigint not null default 0,
  mime             text not null default '',
  path             text not null unique,
  uploaded_by      uuid default auth.uid(),
  uploaded_by_name text not null default '',
  created_at       timestamptz not null default now()
);
create index if not exists documents_product_idx on public.documents(product_id);

create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 5000),
  author      uuid default auth.uid(),
  author_name text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists notes_product_idx on public.notes(product_id);

-- Stamp who created / edited a product from the signed-in user, not from the browser.
create or replace function public.products_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now();
  else
    new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
drop trigger if exists products_stamp on public.products;
create trigger products_stamp before insert or update on public.products
for each row execute function public.products_stamp();

create or replace function public.owner_stamp() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'documents' then new.uploaded_by := auth.uid(); else new.author := auth.uid(); end if;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists documents_stamp on public.documents;
create trigger documents_stamp before insert on public.documents for each row execute function public.owner_stamp();
drop trigger if exists notes_stamp on public.notes;
create trigger notes_stamp before insert on public.notes for each row execute function public.owner_stamp();

------------------------------------------------------------------------------
-- 3. ACCESS RULES (row-level security)
------------------------------------------------------------------------------
alter table public.products  enable row level security;
alter table public.documents enable row level security;
alter table public.notes     enable row level security;

drop policy if exists "team reads products"   on public.products;
drop policy if exists "team adds products"    on public.products;
drop policy if exists "team edits products"   on public.products;
drop policy if exists "owner deletes product" on public.products;
create policy "team reads products"   on public.products for select to authenticated using (public.is_team());
create policy "team adds products"    on public.products for insert to authenticated with check (public.is_team());
create policy "team edits products"   on public.products for update to authenticated using (public.is_team()) with check (public.is_team());
create policy "owner deletes product" on public.products for delete to authenticated
  using (public.is_team() and (created_by = auth.uid() or public.is_admin()));

drop policy if exists "team reads documents"   on public.documents;
drop policy if exists "team adds documents"    on public.documents;
drop policy if exists "owner removes document" on public.documents;
create policy "team reads documents" on public.documents for select to authenticated using (public.is_team());
create policy "team adds documents"  on public.documents for insert to authenticated with check (public.is_team());
create policy "owner removes document" on public.documents for delete to authenticated
  using (public.is_team() and (uploaded_by = auth.uid() or public.is_admin()
         or exists (select 1 from public.products p where p.id = product_id and p.created_by = auth.uid())));

drop policy if exists "team reads notes"   on public.notes;
drop policy if exists "team adds notes"    on public.notes;
drop policy if exists "author removes note" on public.notes;
create policy "team reads notes"    on public.notes for select to authenticated using (public.is_team());
create policy "team adds notes"     on public.notes for insert to authenticated with check (public.is_team());
create policy "author removes note" on public.notes for delete to authenticated
  using (public.is_team() and (author = auth.uid() or public.is_admin()));

------------------------------------------------------------------------------
-- 4. FILE STORAGE (private bucket, 50 MB per file)
------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "team reads files"    on storage.objects;
drop policy if exists "team uploads files"  on storage.objects;
drop policy if exists "owner removes files" on storage.objects;
create policy "team reads files" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_team());
create policy "team uploads files" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_team());
create policy "owner removes files" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.is_team() and (
    owner_id = auth.uid()::text or public.is_admin()
    or exists (select 1 from public.products p
               where p.id::text = (storage.foldername(name))[1] and p.created_by = auth.uid())));

------------------------------------------------------------------------------
-- 5. LIVE UPDATES (other people's changes appear without reloading)
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['products','documents','notes'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
