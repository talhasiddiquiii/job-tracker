-- Job Tracker database schema
-- Paste this whole file into Supabase > SQL Editor > New query, then click "Run".
-- It is safe to run more than once.

-- 1. The applications table ------------------------------------------------
create table if not exists public.applications (
  id            uuid primary key default gen_random_uuid(),
  -- Who owns this row. Defaults to the logged-in user, so the app never has
  -- to send it. If the user account is deleted, their rows go too.
  user_id       uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  company       text not null check (char_length(company) between 1 and 200),
  role          text not null check (char_length(role) between 1 and 200),
  status        text not null default 'Saved'
                check (status in ('Saved', 'Applied', 'Interview', 'Offer', 'Rejected', 'Withdrawn')),
  date_applied  date,
  follow_up_on  date,
  role_type     text check (role_type in (
                  'Project coordination', 'Operations', 'Account management',
                  'Sales', 'Recruitment', 'OD / HR / Consulting')),
  source        text check (source in (
                  'SEEK', 'LinkedIn', 'Company site', 'WA Gov Jobs', 'Recruiter', 'Referral')),
  cover_letter  text check (cover_letter in ('None', 'SEEK short', 'Attachment', 'Formal')),
  contact       text check (char_length(contact) <= 300),
  job_link      text check (char_length(job_link) <= 2000 and job_link ~* '^https?://'),
  notes         text check (char_length(notes) <= 5000),
  archived      boolean not null default false,  -- hidden from the main list, but kept
  created_at    timestamptz not null default now()
);

-- Added later: the archive feature. Adds the column to a table made before it existed.
alter table public.applications
  add column if not exists archived boolean not null default false;

-- Speeds up "give me my rows, newest first".
create index if not exists applications_user_created_idx
  on public.applications (user_id, created_at desc);

-- 2. Row Level Security ------------------------------------------------------
-- With RLS on, Postgres refuses every row unless a policy below allows it.
-- This is what makes it safe to put the public (anon/publishable) key in the
-- frontend: the key alone can't read anyone's data.
alter table public.applications enable row level security;

drop policy if exists "Users can read their own applications"   on public.applications;
drop policy if exists "Users can add their own applications"    on public.applications;
drop policy if exists "Users can update their own applications" on public.applications;
drop policy if exists "Users can delete their own applications" on public.applications;

create policy "Users can read their own applications"
  on public.applications for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can add their own applications"
  on public.applications for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own applications"
  on public.applications for update
  to authenticated
  using ((select auth.uid()) = user_id)        -- can only touch your own rows
  with check ((select auth.uid()) = user_id);  -- and can't hand them to someone else

create policy "Users can delete their own applications"
  on public.applications for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- 3. Table permissions -------------------------------------------------------
-- Logged-out visitors (anon) get nothing. Logged-in users get normal access,
-- which the policies above then narrow to their own rows.
revoke all on public.applications from anon;
grant select, insert, update, delete on public.applications to authenticated;
