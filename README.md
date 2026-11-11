# Job Tracker

A mobile-first job application tracker. Plain HTML, CSS and JavaScript (no build step), hosted on GitHub Pages, with [Supabase](https://supabase.com) for login and the database.

Live site: https://talhasiddiquiii.github.io/job-tracker/

## Features

- Email magic-link login — no passwords. Only logged-in users see the app.
- Each user sees only their own applications (enforced by the database, not just the app).
- Applications shown as cards, newest first, with coloured status pills and status filters.
- Add/edit form with dropdowns. "Follow up on" defaults to 7 days after the date applied.
- Summary bar: total applied, interviews, offers, interview rate, and follow-ups due (highlighted; tap it to filter).
- Tap a card to edit it or change its status. Deleting asks for confirmation.

## Files

| File | What it does |
|---|---|
| `index.html` | The page structure: login screen, app screen and the add/edit form. |
| `style.css` | The look: colours, Inter font, large tap targets, layout from 360px up. |
| `app.js` | Login, loading/saving data with Supabase, and drawing the cards and summary. |
| `schema.sql` | Creates the `applications` table and the Row Level Security rules. Run once in Supabase. |

## Setup

### 1. Create the database table
1. Open your project at https://supabase.com/dashboard.
2. Go to **SQL Editor** → **New query**.
3. Paste the whole of `schema.sql` and click **Run**. You should see "Success. No rows returned".
4. Check **Table Editor** → `applications` shows **RLS enabled**.

### 2. Point Supabase login at GitHub Pages
1. Go to **Authentication** → **URL Configuration**.
2. Set **Site URL** to `https://talhasiddiquiii.github.io/job-tracker/`
3. Under **Redirect URLs**, click **Add URL** and add `https://talhasiddiquiii.github.io/job-tracker/` (and `https://talhasiddiquiii.github.io/job-tracker/**` if you like).
4. Save.

### 3. Turn on GitHub Pages
1. On GitHub, open the repo → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose the branch (`main` once this work is merged) and folder `/ (root)`, then **Save**.
4. After a minute or two the site appears at the address above.

### Running it locally (optional)
Any static server works, e.g. `python3 -m http.server 8000`, then open http://localhost:8000. To log in locally you must also add `http://localhost:8000/` to Supabase's **Redirect URLs**.

## Security notes

- The key in `app.js` is the **publishable (anon) key**. It's designed to be public. On its own it can't read anything, because **Row Level Security** only returns rows where `user_id` matches the logged-in user.
- **Never** put the `service_role` / secret key in this repo — it bypasses Row Level Security.
- User-entered text is displayed with `textContent`, never `innerHTML`, so it can't inject code. Job links must start with `http://` or `https://`.
- A Content Security Policy in `index.html` limits which servers the page can load scripts from and talk to, and the Supabase library is pinned with an integrity hash.

## Changing the dropdown options

The options live in two places that must match: the `check (... in (...))` lines in `schema.sql` and the lists at the top of `app.js`. To add one, update both (for the database, drop and re-add the constraint in the SQL Editor).
