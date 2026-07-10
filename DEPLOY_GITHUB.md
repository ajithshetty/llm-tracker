# Deploying for free on GitHub

GitHub itself only hosts **static** sites for free (GitHub Pages) — it can't
run an always-on FastAPI server. So the free path reshapes the architecture
slightly instead of just moving the Docker setup as-is:

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  GitHub Actions          │        │  GitHub Pages                 │
│  "Refresh model data"     │──────▶│  static frontend build         │
│  (cron + manual button)   │ commit │  reads backend/data/models.json│
│  fetch -> Claude -> JSON  │        │  bundled straight into it      │
└─────────────────────────┘        └──────────────────────────────┘
```

- No server runs between refreshes — cost is $0, always.
- The interactive "Fetch live data" button becomes a **scheduled GitHub
  Action** (daily by default) plus a **manual "Run workflow" button** on the
  Actions tab — GitHub's own UI, not your site (a public static site can't
  safely hold a secret that lets it trigger workflows or call Claude).
- Your Anthropic key never leaves GitHub — it's a repo secret, only used
  inside the Action's runner.

This repo already has both workflows wired up:
`.github/workflows/refresh-data.yml` and `.github/workflows/deploy-pages.yml`.

## Setup (one time)

1. **Push this repo to GitHub** (public, so Pages is free — private repos
   need GitHub Pro/Team for Pages).

2. **Add your Anthropic key as a secret**:
   Repo → Settings → Secrets and variables → Actions → New repository secret
   → name `ANTHROPIC_API_KEY`, value your real key.

3. **Enable Pages**:
   Repo → Settings → Pages → Source → **GitHub Actions** (not "Deploy from a
   branch" — the workflow handles it).

4. **Run the data refresh once manually**:
   Repo → Actions tab → "Refresh model data" → Run workflow. This fetches
   Hugging Face + static model data, summarizes with Claude, and commits
   `backend/data/models.json` back to the repo.

5. **Deploy the frontend**:
   The "Deploy to GitHub Pages" workflow runs automatically whenever step 4
   finishes (or whenever you push to `frontend/`). You can also trigger it
   manually the same way. Once it finishes, your site is live at:
   ```
   https://<your-username>.github.io/<repo-name>/
   ```

That's it — no server, no Docker, no hosting bill.

## How the refresh cadence works

`refresh-data.yml` runs on a cron (`0 6 * * *` = daily at 06:00 UTC by
default — edit the cron line to change it) **and** has `workflow_dispatch`,
which is what puts a "Run workflow" button on the Actions tab. Click it any
time you want fresh data outside the schedule. When it finishes, it commits
the new `models.json`, which triggers `deploy-pages.yml` to rebuild and
republish the site automatically.

## What changed in the frontend for this mode

`frontend/src/App.jsx` now supports `VITE_STATIC_MODE=true` (set by the
Pages workflow, not something you need to touch locally):
- Skips `/api/status` and `/api/fetch-live` entirely.
- Reads model data from a JSON file bundled into the build
  (`frontend/public/data/models.json`, copied from `backend/data/models.json`
  during the Pages workflow) instead of calling a backend.
- Replaces the "Fetch live data" button with a note pointing at the GitHub
  Actions tab, since there's no server to click a button against.

Your Docker/local setup from before is untouched — `VITE_STATIC_MODE` is
simply unset there, so it behaves exactly as it did.

## If you want the real button back (a live server)

Static hosting can't run your Python backend. If keeping an interactive,
click-to-fetch button matters more than staying at $0, you need *some*
compute, even if free-tier:
- **Render.com** free web service — sleeps after 15 min idle, cold-starts on
  the next request (10-30s delay), fine for personal/demo use.
- **Fly.io** free allowance — small always-on VM, no sleep, still free at
  low usage.
- **Railway** — free trial credits, then paid.

Any of these can run the same `Dockerfile` from `backend/` unchanged — you'd
just point `VITE_API_BASE` at that service's URL instead of
`localhost:8000`, and keep GitHub Pages for the frontend only. That's a
middle ground between "fully free, scheduled refresh" (this guide) and the
full AWS setup from before.
