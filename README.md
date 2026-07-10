# LLM Release Ledger



[https://ajithshetty.github.io/llm-tracker/](https://ajithshetty.github.io/llm-tracker/)



Two services:

- **backend** — FastAPI, port `8000` (config, sources, Claude summarization, local JSON storage)
- **frontend** — React/Vite dashboard, built and served by nginx, port `3000`

## 1. One-time setup

```bash
cd llm-release-ledger
cp backend/.env.example backend/.env
# edit backend/.env and paste your real key:
#   ANTHROPIC_API_KEY=sk-ant-...
```

## 2. Build and run

```bash
docker compose up --build
```

First run builds both images (backend installs Python deps, frontend runs
`npm install` + `vite build` then copies the static bundle into nginx). This
takes a minute or two; subsequent runs are cached and fast.

## 3. Use it

Open **[http://localhost:3000](http://localhost:3000)**.

- The dashboard loads whatever's already in `backend/data/models.json` (empty
the first time — you'll see a "no data yet" screen).
- Click **Fetch live data** to run the pipeline: it calls Hugging Face for
the open-weight models, merges in the static closed-model list, sends it
all to Claude to normalize + summarize, and writes the result to
`backend/data/models.json` — which is a real file on your machine, not
just inside the container, thanks to the volume mount in
`docker-compose.yml`.
- Reload or reopen the tab any time — `GET /api/models` just re-serves that
file, no API calls made.



## 4. Turn the button off

Edit `backend/config.yaml`:

```yaml
features:
  enable_live_fetch: false
```

Save it — **no rebuild or restart needed**. The backend re-reads
`config.yaml` on every request (it's volume-mounted into the container), so
the very next click on "Fetch live data" gets a 423 and the button disables
itself in the UI. Flip it back to `true` to re-enable, same way.

## 5. Stopping / cleaning up

```bash
docker compose down          # stop both containers
docker compose down -v       # also remove any anonymous volumes
docker compose up --build    # rebuild after changing code or Dockerfiles
```

Your fetched data survives `docker compose down` because it lives in
`backend/data/` on your host machine, not inside the container.

## 6. Common issues


| Symptom                                                       | Likely cause                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Frontend loads but "Couldn't reach the backend"               | Backend container not healthy yet — check `docker compose logs backend`                     |
| `Fetch live data` returns a CORS error in the browser console | `backend/config.yaml` → `server.cors_origins` doesn't include `http://localhost:3000`       |
| Button greyed out even though you want it on                  | `features.enable_live_fetch` is `false` in `backend/config.yaml`                            |
| Fetch runs but fails with an Anthropic error                  | Check `backend/.env` has a valid `ANTHROPIC_API_KEY`, then `docker compose restart backend` |
| Changed frontend API URL and it's not picking up              | `VITE_API_BASE` is baked in at *build* time — run `docker compose up --build frontend`      |




## Project layout

```
llm-release-ledger/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── config.yaml       # sources, Claude key ref, feature flag, storage path
│   ├── .env               # ANTHROPIC_API_KEY (you create this, gitignored)
│   ├── app/                # FastAPI application
│   └── data/               # models.json + backups land here (volume-mounted)
└── frontend/
    ├── Dockerfile          # multi-stage: vite build -> nginx serve
    ├── nginx.conf
    ├── package.json
    └── src/App.jsx         # the dashboard
```

