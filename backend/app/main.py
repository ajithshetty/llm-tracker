import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import get_config, project_root
from .pipeline import run_pipeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("llm-tracker")

app = FastAPI(title="LLM Release Ledger API", version="1.0.0")

# CORS is set up from config at request time inside a middleware wrapper,
# but Starlette needs origins at app-construction time — read once here.
# If you change cors_origins, restart the process (this is the one setting
# that isn't hot-reloaded, since middleware is wired at startup).
_cfg_at_startup = get_config()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cfg_at_startup.get("server", {}).get("cors_origins", ["*"]),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _resolve_path(cfg_path: str) -> Path:
    p = Path(cfg_path)
    return p if p.is_absolute() else (project_root() / p).resolve()


@app.get("/api/status")
def status():
    cfg = get_config()
    output_path = _resolve_path(cfg.get("storage", {}).get("output_path", "./data/models.json"))
    last_updated = None
    model_count = 0
    if output_path.exists():
        try:
            with open(output_path) as f:
                data = json.load(f)
            last_updated = data.get("generated_at")
            model_count = len(data.get("models", []))
        except Exception:
            logger.exception("Failed reading existing data file for status")

    return {
        "live_fetch_enabled": bool(cfg.get("features", {}).get("enable_live_fetch", False)),
        "last_updated": last_updated,
        "model_count": model_count,
    }


@app.get("/api/models")
def get_models():
    """The frontend's normal data source — reads whatever was last written
    to disk. Does NOT touch any external source or API key."""
    cfg = get_config()
    output_path = _resolve_path(cfg.get("storage", {}).get("output_path", "./data/models.json"))
    if not output_path.exists():
        raise HTTPException(
            status_code=404,
            detail="No data yet. Trigger POST /api/fetch-live at least once (if enabled).",
        )
    with open(output_path) as f:
        return json.load(f)


@app.post("/api/fetch-live")
async def fetch_live():
    """Fetches all configured sources, summarizes with Claude, writes to disk.
    Gated by features.enable_live_fetch in config.yaml — flip that to false
    to take this endpoint (and the frontend button) offline instantly."""
    cfg = get_config()
    if not cfg.get("features", {}).get("enable_live_fetch", False):
        raise HTTPException(
            status_code=423,
            detail="Live fetch is disabled by the server administrator (features.enable_live_fetch=false in config.yaml).",
        )

    try:
        payload = await run_pipeline(cfg)
    except RuntimeError as exc:
        logger.error("Pipeline failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unexpected pipeline failure")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {exc}") from exc

    return {
        "ok": True,
        "generated_at": payload["generated_at"],
        "model_count": len(payload["models"]),
        "message": "Live data fetched, summarized, and written to disk.",
    }


@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}
