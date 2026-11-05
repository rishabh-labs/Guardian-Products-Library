# Products Library: setup

This is a website your team opens in Chrome. It needs two free accounts:

- **Supabase** keeps the products, the uploaded documents and the team logins.
- **GitHub Pages** hosts the website itself.

You don't need a Claude subscription for any of it. Setup takes about 20 minutes and only happens once.

---

## Step 1. Create the database (Supabase)

1. Go to <https://supabase.com>, click **Start your project** and sign up. Signing in with GitHub is easiest.
2. Click **New project**.
   - Name: `products-library`
   - Database password: click **Generate a password** and save it somewhere safe.
   - Region: **South Asia (Mumbai)**
   - Plan: **Free**
3. Wait about 2 minutes for the project to finish setting up.
4. In the left menu, open **SQL Editor** → **New query**.
5. Open `supabase/schema.sql` from this folder, copy all of it, paste it into the editor and press **Run**. You should see "Success. No rows returned".
   - The file allows anyone signing in with an **@gcia.in** email and makes **rishabh@gcia.in** the admin. To change either, edit the two lines marked `EDIT HERE` before you run it.
6. Open **Authentication** → **Sign In / Providers** (on some dashboards it's **Providers → Email**):
   - Turn **off** "Allow new users to sign up". Only you will create accounts.
   - Leave "Email" turned on.
7. Open **Project Settings** → **API**. Copy the **Project URL** and the **anon public** key into `config.js` in this folder, replacing the `PASTE_…` placeholders.

## Step 2. Add your team

In Supabase open **Authentication** → **Users** → **Add user** → **Create new user**:

- Email: their work email
- Password: a temporary one you tell them
- Tick **Auto Confirm User**

The first time each person signs in, the site asks for their name and lets them choose their own password.

- **To reset a forgotten password:** open the user in the same list and set a new one.
- **To add someone from outside @gcia.in:** create their user as above, then run this in the SQL Editor:
  `insert into team_access (email) values ('name@other.com');`
- **To make someone an admin:** run
  `insert into team_access (email, role) values ('name@gcia.in','admin') on conflict (email) do update set role='admin';`

## Step 3. Put the website online (GitHub Pages)

1. Sign in at <https://github.com>, click **+** → **New repository**.
   - Name: `products-library`
   - Visibility: **Public**. Free GitHub Pages needs a public repository. The code holds no data and no passwords: everything sits behind the sign-in, and the anon key is meant to be public.
   - Click **Create repository**.
2. On the new repository's page, click **uploading an existing file**. Drag in everything from this folder, including the `.github` and `supabase` folders, then click **Commit changes**.
   - If you use git, `git push` from this folder works too.
3. Open **Settings** → **Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, branch **main**, folder **/ (root)**, and click **Save**.
4. After a minute the site goes live at `https://<your-github-username>.github.io/products-library/`. Share that link with the team.
5. Back in Supabase, open **Authentication** → **URL Configuration** and set **Site URL** to that link.

## Keeping it running

- **Supabase free limits:** 500 MB of database, 1 GB of files and 50 MB per file. A small team won't reach these for a long time. For more space, the Pro plan is $25 a month.
- **Pauses after 7 days unused.** Supabase pauses free projects after a week with no activity. The `.github/workflows/keepalive.yml` job pings the database every 3 days to prevent that. If it ever does pause, open the Supabase dashboard and click **Restore project**. No data is lost.
- **Backups:** to keep your own copy of the records, open **Table Editor**, pick `products`, and use **Export → CSV**. Files can be downloaded from **Storage → documents**.

## Changing the site later

Edit the files and upload them to the GitHub repository again. Pages republishes within a minute.

| File | What it holds |
|---|---|
| `index.html` | Page layout |
| `styles.css` | Look and colours |
| `app.js` | Behaviour, including the category list at the top |
| `config.js` | Which Supabase project the site uses |
