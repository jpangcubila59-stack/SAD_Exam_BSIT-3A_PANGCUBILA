# Student Scholarship Monitoring and Academic Compliance System

## Files
- `index.html` — login page
- `css/styles.css` — responsive login and dashboard styling
- `js/config.js` — Supabase URL and publishable/anon key settings
- `js/auth.js` — validation, Supabase sign-in, and role-based redirect
- `js/dashboard.js` — scholar and staff dashboard workflows
- `scholar-dashboard.html` — semester submissions, correction, and status tracking
- `staff-dashboard.html` — scholar assignment, verification, evaluation, decisions, search, and activity
- `database/schema.sql` — tables, policy seeds, row-level security, validation triggers, and audit history

## Run in VS Code
1. Open the project folder in VS Code.
2. Use Live Server on `index.html`, or run `python -m http.server 8000` and open `http://localhost:8000`.
3. Configure Supabase and run the SQL setup below before signing in.

## Connect Supabase
1. Open your Supabase project and go to **Project Settings > API**.
2. Copy the project URL and publishable/anon key into `js/config.js`.
3. Run the current `database/schema.sql` in the Supabase SQL Editor. It is safe to rerun and creates the Merit Scholar and Community Scholar policies only if they do not already exist, preserving configured thresholds.
4. Create a staff account in **Authentication > Users**. Add its profile using the actual Auth UUID and role `staff`:

```sql
insert into public.profiles (id, email, full_name, role)
values ('PASTE-STAFF-AUTH-UUID-HERE', 'staff@example.com', 'Scholarship Staff', 'staff')
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role;
```

5. Sign in as staff. In the Staff Dashboard, assign existing Auth users to a program using their Auth UUID, email, student ID, and name. The dashboard creates or updates their scholar profile. Create scholar Auth users in Supabase first; this browser app never creates Auth users or handles passwords.
6. Scholars sign in and submit their semester summary and grade-document reference. Staff verify or return evidence, evaluate verified records against the assigned program's stored policy, and explicitly record renewal decisions.

## Dashboard behavior
- Staff can search by scholar name or student ID and filter by program or compliance result.
- Overview counts use the selected academic year and semester; assigned scholar count covers all current assignments.
- Verification, evaluation, renewal decisions, and resubmissions are written to `submission_history` with actor and timestamp.
- The deadline and thresholds are stored in the `programs` table and can be adjusted by staff through the database.
- This is an exam MVP; it does not integrate with a Registrar, process payments, or implement appeals.
- The database enforces role access and workflow rules. Scholars can read only their own assignments, submissions, and history. Approval is blocked unless the submission is verified and compliant. Returned submissions can be corrected and resubmitted; duplicate semester entries are rejected.

Existing sessions must run the updated schema to create the dashboard tables, policies, and triggers. Do not rerun older SQL that restores a profile self-update policy.

## Security
- Never put a Supabase `service_role` key in browser code.
- Role redirects are not a security boundary; database row-level security and workflow triggers enforce access.
- Profile role changes must use a trusted administrative process.
- Both Login and Sign In buttons trigger the same authentication action.
