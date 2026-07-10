# LLM Release Ledger — backend

FastAPI service that:
1. Fetches configured sources (live Hugging Face stats for open-weight models,
   a maintained static list for closed API models).
2. Sends the raw data to Claude to normalize/dedupe and write a short summary.
3. Writes the result to a local JSON file (path set in `config.yaml`).
4. Serves that file to your frontend.

The frontend never talks to Hugging Face or Anthropic directly — it only
talks to this API.

## 1. Setup

```bash
cd llm-tracker-backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Anthropic key goes in the environment, NOT in config.yaml
export ANTHROPIC_API_KEY="sk-ant-..."

./run.sh          # http://localhost:8000
```

Or with a `.env` file (auto-loaded):
```
ANTHROPIC_API_KEY=sk-ant-...
```

## 2. Config file (`config.yaml`)

| Key | What it does |
|---|---|
| `features.enable_live_fetch` | Master on/off switch. Set `false` to disable `POST /api/fetch-live` (returns HTTP 423) — this is your "turn off the fresh live data button" control. |
| `anthropic.api_key` | `${ANTHROPIC_API_KEY}` — pulled from env, never stored in plaintext. |
| `anthropic.model` | Which Claude model to use for summarization. |
| `storage.output_path` | Local path the frontend's data comes from. |
| `sources.huggingface.repos` | Open-weight models to live-fetch (HF download/like counts). Add/remove entries here — no code changes needed. |
| `sources.static_models` | Closed models (pricing/context/release) — maintained by hand since no usage API exists for them. |

The config is **re-read from disk on every request** (except `cors_origins`,
which is read once at startup). Flip `enable_live_fetch` and it takes effect
on the very next call — no restart needed.

## 3. API

- `GET /api/status` → `{ live_fetch_enabled, last_updated, model_count }`
  Frontend polls this to decide whether to show/enable the "Fetch live data"
  button.
- `GET /api/models` → the last written JSON payload (what your dashboard renders).
  Returns 404 if nothing has been fetched yet.
- `POST /api/fetch-live` → runs the full pipeline (sources → Claude → disk).
  Returns 423 if `enable_live_fetch` is false.

## 4. Frontend integration

Replace the dashboard's direct `fetch("https://huggingface.co/api/models/...")`
calls with calls to this backend instead:

```js
// on load
const status = await fetch(`${API_BASE}/api/status`).then(r => r.json());
setLiveFetchEnabled(status.live_fetch_enabled);

const data = await fetch(`${API_BASE}/api/models`).then(r => r.ok ? r.json() : null);
if (data) setModels(data.models);

// "Fetch live data" button
async function onFetchLiveClick() {
  const res = await fetch(`${API_BASE}/api/fetch-live`, { method: "POST" });
  if (res.status === 423) { alert("Live fetch is disabled by the admin."); return; }
  const result = await res.json();
  // re-pull the freshly written data
  const data = await fetch(`${API_BASE}/api/models`).then(r => r.json());
  setModels(data.models);
}
```

Render the button `disabled={!liveFetchEnabled}` (or hide it) based on
`/api/status`.

## 5. Adding a new source

Write a `fetch_x(cfg) -> list[dict]` function in `app/sources.py` returning
records in the same shape as the existing ones, then add it to
`fetch_all_sources()`. Add any connection details (API base URL, auth) to
`config.yaml` under `sources.x`.

---

# AWS deployment

## Architecture (small-scale, single-service)

```
                         ┌───────────────────────────┐
                         │        Route 53           │
                         │   (your domain, optional)  │
                         └─────────────┬─────────────┘
                                       │
                         ┌─────────────▼─────────────┐
                         │        CloudFront          │  (frontend static assets
                         │   (CDN + HTTPS + caching)   │   + optional API caching)
                         └──────┬───────────┬─────────┘
                                │           │
                  ┌─────────────▼───┐   ┌───▼─────────────────────┐
                  │   S3 bucket      │   │   ALB (Application     │
                  │  (React build:   │   │   Load Balancer)        │
                  │   static files)  │   └───┬─────────────────────┘
                  └──────────────────┘       │
                                   ┌─────────▼──────────┐
                                   │   ECS Fargate       │
                                   │   (FastAPI service, │
                                   │   1+ tasks)         │
                                   └───┬────────┬────────┘
                                       │        │
                          ┌────────────▼─┐   ┌──▼─────────────────┐
                          │  EFS volume   │   │ Secrets Manager /   │
                          │ (data/models  │   │ SSM Parameter Store │
                          │  .json lives  │   │ (ANTHROPIC_API_KEY) │
                          │  here — real  │   └─────────────────────┘
                          │ "local path") │
                          └───────────────┘
                                       │
                          ┌────────────▼─────────────┐
                          │  Outbound to huggingface.co │
                          │  and api.anthropic.com       │
                          │  via NAT Gateway              │
                          └───────────────────────────────┘

                   CloudWatch Logs + Alarms wired to the ECS service throughout.
```

Why EFS instead of S3 for the data file: your design reads from a **local
path**, and EFS is the AWS-native way to give a container a real POSIX
filesystem that survives task restarts/redeploys — no code changes needed.
(Alternative: skip EFS and just rely on the API's own `GET /api/models`
endpoint, since the frontend never needs filesystem access directly — only
the backend does. In that case Fargate's ephemeral storage is enough, but
the file is lost on every redeploy, which is usually fine since a redeploy
is a good moment to re-run `fetch-live` anyway.)

## Steps

**1. Containerize**
```bash
docker build -t llm-tracker-backend .
```

**2. Push to ECR**
```bash
aws ecr create-repository --repository-name llm-tracker-backend
aws ecr get-login-password | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
docker tag llm-tracker-backend:latest <account-id>.dkr.ecr.<region>.amazonaws.com/llm-tracker-backend:latest
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/llm-tracker-backend:latest
```

**3. Store the Anthropic key in Secrets Manager**
```bash
aws secretsmanager create-secret --name llm-tracker/anthropic-api-key --secret-string "sk-ant-..."
```

**4. Network**
- VPC with 2 public subnets (ALB) + 2 private subnets (Fargate tasks).
- NAT Gateway in a public subnet so private-subnet tasks can reach
  `huggingface.co` and `api.anthropic.com`.

**5. EFS (if you want a true persistent local path)**
- Create an EFS filesystem, mount targets in the private subnets.
- In the ECS task definition, add an EFS volume mounted at `/app/data`.

**6. ECS Fargate service**
- Task definition: your ECR image, 0.5 vCPU / 1GB is plenty to start.
- Inject `ANTHROPIC_API_KEY` from Secrets Manager as a task secret (not a
  plain env var) — set `container.secrets = [{name: ANTHROPIC_API_KEY, valueFrom: <secret arn>}]`.
- Mount the EFS volume at `/app/data` if using EFS.
- Security group: allow inbound 8000 only from the ALB's security group.
- Service behind an internal target group; ALB listener on 443 (ACM cert)
  forwards `/api/*` and `/health` to the target group.

**7. Frontend**
- Build the React app (`npm run build`), upload to an S3 bucket configured
  for static website hosting (or served via CloudFront + S3 origin).
- CloudFront distribution in front of the S3 bucket, with a second
  behavior/origin routing `/api/*` to the ALB — this lets frontend and API
  share one domain without extra CORS config.

**8. DNS + TLS**
- Route 53 record pointing your domain at the CloudFront distribution.
- ACM certificate (in `us-east-1` for CloudFront) covering that domain.

**9. Observability**
- ECS service logs → CloudWatch Logs (enable in task definition).
- CloudWatch Alarm on ECS task health / 5xx rate from the ALB.
- Optional: EventBridge scheduled rule to hit `POST /api/fetch-live` on a
  cadence (e.g. daily) instead of relying only on the manual button —
  useful once you trust the pipeline, still governed by the same
  `enable_live_fetch` flag.

## Cheaper/simpler alternative

If you don't need the ALB/EFS/VPC complexity: deploy the same Docker image
to **AWS App Runner** directly from ECR. App Runner gives you HTTPS, a
public URL, and autoscaling out of the box. Use S3 (instead of EFS) to
persist `models.json` between deploys — write to `/tmp` locally, then have
`pipeline.py` also upload the file to S3, and have `GET /api/models` read
from S3 if the local file is missing. Good starting point before you need
the full VPC setup above.
