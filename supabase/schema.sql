-- Research Paper Revision Assistant — Supabase schema
-- Run in Supabase SQL editor. RLS on every table keyed to auth.uid().

-- Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  display_name text
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Projects (findings JSON only — PDFs never stored)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled paper',
  created_at timestamptz not null default now(),
  similarity_pct numeric,
  ai_pct numeric,
  report_format_version text
);

create index if not exists projects_user_id_idx on public.projects (user_id);

alter table public.projects enable row level security;

create policy "projects_select_own" on public.projects
  for select using (auth.uid() = user_id);
create policy "projects_insert_own" on public.projects
  for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on public.projects
  for update using (auth.uid() = user_id);
create policy "projects_delete_own" on public.projects
  for delete using (auth.uid() = user_id);

-- Findings (status is training signal — log from day one)
create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null,
  category text not null,
  start_offset int not null default 0,
  end_offset int not null default 0,
  page int not null default 1,
  source_url text,
  source_title text,
  match_pct numeric,
  explanation text,
  suggestion text,
  status text not null default 'open'
    check (status in ('open', 'accepted', 'dismissed', 'edited')),
  text_snapshot text,
  is_informational boolean default false,
  confidence numeric,
  source_type text,
  user_note text,
  edited_text text,
  citation_warning boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists findings_project_id_idx on public.findings (project_id);
create index if not exists findings_status_idx on public.findings (status);

alter table public.findings enable row level security;

create policy "findings_select_own" on public.findings
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = findings.project_id and p.user_id = auth.uid()
    )
  );
create policy "findings_insert_own" on public.findings
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = findings.project_id and p.user_id = auth.uid()
    )
  );
create policy "findings_update_own" on public.findings
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = findings.project_id and p.user_id = auth.uid()
    )
  );
create policy "findings_delete_own" on public.findings
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = findings.project_id and p.user_id = auth.uid()
    )
  );

-- Per-user daily usage for Groq rate limiting
create table if not exists public.usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null default (timezone('utc', now()))::date,
  tokens_used int not null default 0,
  requests_made int not null default 0,
  primary key (user_id, date)
);

alter table public.usage enable row level security;

create policy "usage_select_own" on public.usage
  for select using (auth.uid() = user_id);
create policy "usage_insert_own" on public.usage
  for insert with check (auth.uid() = user_id);
create policy "usage_update_own" on public.usage
  for update using (auth.uid() = user_id);

-- Service-role helpers for Netlify functions should use the service key
-- and bypass RLS. Client never writes tokens_used above the cap.

-- Keep-alive: hit this view or any table from GitHub Actions hourly
-- so free-tier projects are not paused after 7 days idle.
create or replace view public.keepalive as
  select 1::int as ok;
