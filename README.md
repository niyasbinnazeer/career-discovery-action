# Career Discovery — GitHub Actions setup

This folder is the **discovery cron** rewritten as a GitHub Action. It does
exactly what the Cloudflare discovery worker does, but:

- No 50-subrequest cap → analyzes up to 30 jobs per run (vs 5 before)
- Free at any scale on public repos (unlimited Actions minutes)
- Easier to debug (full Node.js logs in the Actions tab)

The analyzer worker and dashboard worker stay on Cloudflare unchanged. Only the
cron moves here.

---

## Step-by-step setup (~30 minutes)

You'll need to do four things, in this order:

1. Create a new GitHub repo and upload these files
2. Get your Cloudflare account ID + KV namespace ID + a scoped API token
3. Add all six secrets to the GitHub repo
4. Disable the old Cloudflare cron so they don't both run

---

### 1. Create the GitHub repo

1. Go to <https://github.com/new>
2. Repo name: anything, e.g. `career-discovery-action`
3. **Make it Public** — public repos get unlimited free GitHub Actions minutes
   (private repos get 2000 free/month, also plenty, but public is free forever)
4. Click **Create repository**
5. Upload these files (keep the folder structure exactly as shown):
   ```
   discovery.mjs
   package.json
   .github/workflows/discovery.yml
   README.md   (this file)
   ```
   You can drag-drop them into the GitHub web UI, or clone and push with git.
   The `.github/workflows/discovery.yml` path matters — GitHub looks there.

---

### 2. Get your Cloudflare credentials

You'll need three values from Cloudflare. Open your Cloudflare dashboard.

#### 2a. Account ID

1. From the main dashboard, click any worker (e.g. `career-discovery`)
2. On the right sidebar there's an **Account ID** with a copy button
3. Copy it. Looks like: `7af6667020168f682410d543c970b2f1`

#### 2b. KV Namespace ID

1. In the Cloudflare sidebar: **Storage & Databases** → **KV**
2. Find the `career_jobs` namespace and copy its **ID** (the long hex string,
   NOT the name). It will look like: `abc123def4567890abc123def4567890`

#### 2c. API Token (scoped — important for safety)

We want a token that can ONLY read/write KV, nothing else. If this token ever
leaked, the worst someone could do is mess with your job database.

1. Cloudflare → **Manage Account** (top-right profile menu) → **Account API
   Tokens**
2. Click **Create Token**
3. Click **Create Custom Token** (don't use a template)
4. Token name: `career-discovery-kv-access`
5. Under **Permissions**, add ONE row:
   - **Account** → **Workers KV Storage** → **Edit**
6. Under **Account Resources**: select your account (`Niyasbinnazeer@gmail.com`)
7. Optional: under **TTL**, leave default (no expiration)
8. Click **Continue to summary** → **Create Token**
9. **Copy the token immediately** — you only see it once. It looks like a long
   random string.

If you lose it, just create a new one and update the GitHub secret.

---

### 3. Add the six secrets to the GitHub repo

1. In your new GitHub repo: **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**
2. Add each of the following (name on the left, value on the right):

| Secret name | Value |
|---|---|
| `CF_ACCOUNT_ID` | Your Cloudflare account ID (step 2a) |
| `CF_KV_NAMESPACE_ID` | The `career_jobs` namespace ID (step 2b) |
| `CF_API_TOKEN` | The scoped API token (step 2c) |
| `CAREER_ANALYZER_URL` | `https://career-intelligence-api.niyasbinnazeer.workers.dev` |
| `ADZUNA_APP_ID` | Your Adzuna App ID (e.g. `ecbff215`) |
| `ADZUNA_APP_KEY` | Your Adzuna App Key |

3. After adding all six, the Secrets page should list all six names (values
   are hidden once saved — that's correct).

---

### 4. Test it manually before letting the cron run

1. In your repo, click the **Actions** tab
2. Click **Career Discovery** in the left sidebar
3. Click **Run workflow** → **Run workflow** (green button on the right)
4. After ~30 seconds, a yellow-then-green run appears. Click it to see the log.
5. Expand the **Run discovery** step. The bottom of the log should show a JSON
   summary like:
   ```json
   {
     "ranAt": "...",
     "rawCollected": 200+,
     "passedPrefilter": 50+,
     "skippedDuplicates": ...,
     "analyzedAndSaved": 20+,
     ...
   }
   ```
6. Open your dashboard. New jobs should appear. Confirm with the **Refresh**
   button.

If something fails, the log shows exactly which step (CF auth error, KV
namespace ID wrong, Adzuna 401, analyzer URL wrong, etc.) — way easier to
debug than Worker logs.

---

### 5. Disable the old Cloudflare cron so they don't run together

Once you've confirmed the GitHub Action works:

1. Cloudflare → `career-discovery` worker → **Settings** → **Triggers**
2. Find the cron schedule `0 */2 * * *` and **delete** it (the trash icon)
3. The worker itself still exists (and `/run` and `/status` endpoints still
   work for manual use) — only the schedule is removed.

You can also delete the `career-discovery` worker entirely if you want, but
keeping it doesn't cost anything and the `/status` URL is still useful for
spot-checks.

---

## Day-to-day usage

- **Automatic runs:** every 2 hours, automatic, free.
- **Manual run:** Actions tab → Career Discovery → Run workflow.
- **See last run:** the Actions tab shows every run with full logs.
- **Change settings:** edit `discovery.mjs` (cap, queries, sources) → commit →
  next scheduled run uses the new version.
- **Change cron frequency:** edit `.github/workflows/discovery.yml`, change
  `cron: "0 */2 * * *"` to e.g. `cron: "0 * * * *"` for hourly.

---

## What to expect

- **First run:** the rotation cursor is fresh, so Adzuna will fire its first
  12 country×query combinations. Analyzed count will be high — probably the
  full 30 — as new jobs flow in.
- **Subsequent runs:** dedup kicks in. Most passes will show `skippedDuplicates`
  growing and a smaller number of new analyses, until the next rotation slice
  brings in fresh material.
- **Over ~14 hours:** the full Adzuna matrix (160 combinations) gets covered.
  After that it cycles, catching new postings as they appear.

---

## If you want to undo

Delete the GitHub repo (everything stops). Re-add the cron `0 */2 * * *` to
the `career-discovery` worker on Cloudflare. The system reverts exactly.
