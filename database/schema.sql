-- Run in the Supabase SQL Editor. Auth users must already exist in Authentication > Users.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  student_id text,
  role text not null default 'scholar' check (role in ('scholar','staff','admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists student_id text;
alter table public.profiles add column if not exists role text default 'scholar';
alter table public.profiles add column if not exists created_at timestamptz default now();

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  max_gwa numeric(3,2) not null check (max_gwa between 1 and 5),
  min_units integer not null check (min_units >= 0),
  max_failed integer not null default 0 check (max_failed >= 0),
  max_incomplete integer not null default 0 check (max_incomplete >= 0),
  max_dropped integer not null default 0 check (max_dropped >= 0),
  deadline timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  scholar_id uuid not null unique references public.profiles(id) on delete cascade,
  program_id uuid not null references public.programs(id),
  award_status text not null default 'active' check (award_status in ('active','suspended','ended')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.assignments add column if not exists award_status text not null default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'assignments_award_status_check'
      and conrelid = 'public.assignments'::regclass
  ) then
    alter table public.assignments
      add constraint assignments_award_status_check
      check (award_status in ('active','suspended','ended'));
  end if;
end;
$$;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  academic_year text not null check (academic_year ~ '^[0-9]{4}-[0-9]{4}$'),
  semester smallint not null check (semester in (1,2,3)),
  gwa numeric(3,2) not null check (gwa between 1 and 5),
  enrolled_units integer not null check (enrolled_units >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  incomplete_count integer not null default 0 check (incomplete_count >= 0),
  dropped_count integer not null default 0 check (dropped_count >= 0),
  evidence_reference text not null check (length(trim(evidence_reference)) between 1 and 500),
  submitted_at timestamptz not null default now(),
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','returned')),
  verification_reason text,
  compliance_status text not null default 'pending' check (compliance_status in ('pending','compliant','with_deficiency')),
  compliance_reasons jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz,
  renewal_status text not null default 'pending' check (renewal_status in ('pending','approved','held')),
  renewal_note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  constraint submissions_semester_unique unique (assignment_id, academic_year, semester)
);

create table if not exists public.submission_history (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.programs
  (code, name, max_gwa, min_units, max_failed, max_incomplete, max_dropped, deadline)
values
  ('merit', 'Merit Scholar', 1.75, 18, 0, 0, 0, '2026-10-30 17:00:00+08'),
  ('community', 'Community Scholar', 2.25, 15, 0, 0, 1, '2026-10-30 17:00:00+08')
on conflict (code) do nothing;

create or replace function public.is_scholarship_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('staff','admin')
  );
$$;

create or replace function public.owns_assignment(target_assignment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assignments
    where id = target_assignment and scholar_id = (select auth.uid())
  );
$$;

create or replace function public.guard_scholar_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.scholar_id and role = 'scholar'
  ) then
    raise exception 'Only a scholar profile can receive a scholarship assignment.';
  end if;
  return new;
end;
$$;

revoke all on function public.is_scholarship_staff() from public;
revoke all on function public.owns_assignment(uuid) from public;
grant execute on function public.is_scholarship_staff() to authenticated;
grant execute on function public.owns_assignment(uuid) to authenticated;

create or replace function public.guard_submission_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy_row public.programs%rowtype;
  reasons text[] := array[]::text[];
begin
  if tg_op = 'INSERT' then
    if not public.owns_assignment(new.assignment_id) then
      raise exception 'You may submit only for your assigned scholarship.';
    end if;
    return new;
  end if;

  if public.is_scholarship_staff() then
    if new.assignment_id is distinct from old.assignment_id
      or new.academic_year is distinct from old.academic_year
      or new.semester is distinct from old.semester
      or new.gwa is distinct from old.gwa
      or new.enrolled_units is distinct from old.enrolled_units
      or new.failed_count is distinct from old.failed_count
      or new.incomplete_count is distinct from old.incomplete_count
      or new.dropped_count is distinct from old.dropped_count
      or new.evidence_reference is distinct from old.evidence_reference
      or new.submitted_at is distinct from old.submitted_at then
      raise exception 'Staff may not alter a scholar submission.';
    end if;

    if new.verification_status is distinct from old.verification_status then
      if new.verification_status not in ('verified','returned') then
        raise exception 'Verification must be marked Verified or Returned.';
      end if;
      if new.verification_status = 'returned'
        and coalesce(length(trim(new.verification_reason)), 0) = 0 then
        raise exception 'Enter a reason before returning evidence.';
      end if;
      new.compliance_status := 'pending';
      new.compliance_reasons := '[]'::jsonb;
      new.evaluated_at := null;
      new.renewal_status := 'pending';
      new.renewal_note := null;
      new.decided_by := null;
      new.decided_at := null;
      return new;
    elsif new.verification_reason is distinct from old.verification_reason then
      raise exception 'A verification reason can only change with verification status.';
    end if;

    if new.compliance_status is distinct from old.compliance_status then
      if old.verification_status <> 'verified' or new.compliance_status = 'pending' then
        raise exception 'Only verified submissions can be evaluated.';
      end if;
      select p.* into policy_row
      from public.assignments a
      join public.programs p on p.id = a.program_id
      where a.id = old.assignment_id;

      if old.gwa > policy_row.max_gwa then
        reasons := array_append(reasons, format('GWA %s exceeds the program limit of %s.', old.gwa, policy_row.max_gwa));
      end if;
      if old.enrolled_units < policy_row.min_units then
        reasons := array_append(reasons, format('Enrolled units %s are below the minimum of %s.', old.enrolled_units, policy_row.min_units));
      end if;
      if old.failed_count > policy_row.max_failed then
        reasons := array_append(reasons, format('Failed subjects %s exceed the allowed maximum of %s.', old.failed_count, policy_row.max_failed));
      end if;
      if old.incomplete_count > policy_row.max_incomplete then
        reasons := array_append(reasons, format('Incomplete grades %s exceed the allowed maximum of %s.', old.incomplete_count, policy_row.max_incomplete));
      end if;
      if old.dropped_count > policy_row.max_dropped then
        reasons := array_append(reasons, format('Dropped subjects %s exceed the allowed maximum of %s.', old.dropped_count, policy_row.max_dropped));
      end if;
      if old.submitted_at > policy_row.deadline then
        reasons := array_append(reasons, 'Submission was received after the program deadline.');
      end if;
      new.compliance_reasons := to_jsonb(reasons);
      new.compliance_status := case when cardinality(reasons) = 0 then 'compliant' else 'with_deficiency' end;
      new.evaluated_at := now();
      new.renewal_status := 'pending';
      new.renewal_note := null;
      new.decided_by := null;
      new.decided_at := null;
    elsif new.compliance_reasons is distinct from old.compliance_reasons
      or new.evaluated_at is distinct from old.evaluated_at then
      raise exception 'Compliance results are generated by the system.';
    end if;

    if new.renewal_status is distinct from old.renewal_status then
      if new.renewal_status not in ('approved','held')
        or old.verification_status <> 'verified'
        or old.compliance_status = 'pending' then
        raise exception 'Evaluate a verified submission before recording a renewal decision.';
      end if;
      if new.renewal_status = 'approved' and old.compliance_status <> 'compliant' then
        raise exception 'Renewal approval requires a Compliant evaluation.';
      end if;
      if coalesce(length(trim(new.renewal_note)), 0) = 0 then
        raise exception 'Enter a note for the renewal decision.';
      end if;
      new.decided_by := (select auth.uid());
      new.decided_at := now();
    elsif new.renewal_note is distinct from old.renewal_note
      or new.decided_by is distinct from old.decided_by
      or new.decided_at is distinct from old.decided_at then
      raise exception 'Decision details can only change with a renewal decision.';
    end if;
    return new;
  end if;

  if not public.owns_assignment(old.assignment_id)
    or old.verification_status <> 'returned'
    or new.assignment_id is distinct from old.assignment_id
    or new.academic_year is distinct from old.academic_year
    or new.semester is distinct from old.semester
    or new.submitted_at is distinct from old.submitted_at then
    raise exception 'Only returned submissions may be corrected, and their semester cannot be changed.';
  end if;

  new.verification_status := 'pending';
  new.verification_reason := null;
  new.compliance_status := 'pending';
  new.compliance_reasons := '[]'::jsonb;
  new.evaluated_at := null;
  new.renewal_status := 'pending';
  new.renewal_note := null;
  new.decided_by := null;
  new.decided_at := null;
  new.submitted_at := now();
  return new;
end;
$$;

create or replace function public.record_submission_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  event_details jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    event_name := 'submitted';
    event_details := jsonb_build_object('academic_year', new.academic_year, 'semester', new.semester);
  else
    if new.verification_status is distinct from old.verification_status then
      event_name := case new.verification_status when 'verified' then 'verified' else 'returned' end;
      event_details := jsonb_build_object('reason', new.verification_reason);
    elsif new.compliance_status is distinct from old.compliance_status then
      event_name := 'evaluated';
      event_details := jsonb_build_object('status', new.compliance_status, 'reasons', new.compliance_reasons);
    elsif new.renewal_status is distinct from old.renewal_status then
      event_name := 'renewal_decided';
      event_details := jsonb_build_object('status', new.renewal_status, 'note', new.renewal_note);
    elsif old.verification_status = 'returned' then
      event_name := 'corrected_and_resubmitted';
    else
      return new;
    end if;
  end if;

  insert into public.submission_history (submission_id, actor_id, action, details)
  values (new.id, (select auth.uid()), event_name, event_details);
  return new;
end;
$$;

drop trigger if exists guard_submission_write on public.submissions;
create trigger guard_submission_write
before insert or update on public.submissions
for each row execute function public.guard_submission_write();

drop trigger if exists guard_scholar_assignment on public.assignments;
create trigger guard_scholar_assignment
before insert or update on public.assignments
for each row execute function public.guard_scholar_assignment();

drop trigger if exists record_submission_history on public.submissions;
create trigger record_submission_history
after insert or update on public.submissions
for each row execute function public.record_submission_history();

alter table public.profiles enable row level security;
alter table public.programs enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_history enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Staff can read all profiles" on public.profiles;
drop policy if exists "Staff can register scholar profiles" on public.profiles;
drop policy if exists "Staff can update scholar profiles" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Admins and staff can read all profiles" on public.profiles;
create policy "Users can read their own profile" on public.profiles
  for select to authenticated using (auth.uid() = id or public.is_scholarship_staff());
create policy "Staff can register scholar profiles" on public.profiles
  for insert to authenticated with check (public.is_scholarship_staff() and role = 'scholar');
create policy "Staff can update scholar profiles" on public.profiles
  for update to authenticated using (public.is_scholarship_staff() and role = 'scholar')
  with check (public.is_scholarship_staff() and role = 'scholar');

drop policy if exists "Authenticated users can read programs" on public.programs;
drop policy if exists "Staff can manage programs" on public.programs;
create policy "Authenticated users can read programs" on public.programs
  for select to authenticated using (true);
create policy "Staff can manage programs" on public.programs
  for all to authenticated using (public.is_scholarship_staff())
  with check (public.is_scholarship_staff());

drop policy if exists "Users can read their assignments" on public.assignments;
drop policy if exists "Staff can manage assignments" on public.assignments;
create policy "Users can read their assignments" on public.assignments
  for select to authenticated using (scholar_id = auth.uid() or public.is_scholarship_staff());
create policy "Staff can manage assignments" on public.assignments
  for all to authenticated using (public.is_scholarship_staff())
  with check (public.is_scholarship_staff());

drop policy if exists "Users can read their submissions" on public.submissions;
drop policy if exists "Scholars can submit" on public.submissions;
drop policy if exists "Scholars can correct returned submissions" on public.submissions;
drop policy if exists "Staff can manage submissions" on public.submissions;
create policy "Users can read their submissions" on public.submissions
  for select to authenticated using (public.owns_assignment(assignment_id) or public.is_scholarship_staff());
create policy "Scholars can submit" on public.submissions
  for insert to authenticated with check (public.owns_assignment(assignment_id));
create policy "Scholars can correct returned submissions" on public.submissions
  for update to authenticated using (public.owns_assignment(assignment_id) and verification_status = 'returned')
  with check (public.owns_assignment(assignment_id));
create policy "Staff can manage submissions" on public.submissions
  for all to authenticated using (public.is_scholarship_staff())
  with check (public.is_scholarship_staff());

drop policy if exists "Users can read their submission history" on public.submission_history;
create policy "Users can read their submission history" on public.submission_history
  for select to authenticated using (
    public.is_scholarship_staff()
    or exists (
      select 1 from public.submissions s
      where s.id = submission_id and public.owns_assignment(s.assignment_id)
    )
  );

grant select on public.profiles, public.programs, public.assignments, public.submissions, public.submission_history to authenticated;
revoke insert, update, delete on public.profiles from authenticated;
grant insert (id, email, full_name, student_id, role) on public.profiles to authenticated;
grant update (email, full_name, student_id) on public.profiles to authenticated;
revoke insert, update, delete on public.programs, public.assignments, public.submissions, public.submission_history from authenticated;
grant insert, update, delete on public.programs, public.assignments to authenticated;
grant insert (assignment_id, academic_year, semester, gwa, enrolled_units, failed_count, incomplete_count, dropped_count, evidence_reference)
  on public.submissions to authenticated;
grant update (assignment_id, academic_year, semester, gwa, enrolled_units, failed_count, incomplete_count, dropped_count, evidence_reference, verification_status, verification_reason, compliance_status, compliance_reasons, evaluated_at, renewal_status, renewal_note, decided_by, decided_at)
  on public.submissions to authenticated;
