import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .sources import fetch_all_sources
from .summarizer import summarize
from .config import project_root


def _resolve_path(cfg_path: str) -> Path:
    p = Path(cfg_path)
    return p if p.is_absolute() else (project_root() / p).resolve()


def _atomic_write(path: Path, payload: dict, backup_dir: Path, keep_backups: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    backup_dir.mkdir(parents=True, exist_ok=True)

    if path.exists():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        shutil.copy2(path, backup_dir / f"models.{stamp}.json")
        backups = sorted(backup_dir.glob("models.*.json"))
        for old in backups[:-keep_backups] if keep_backups > 0 else []:
            old.unlink(missing_ok=True)

    tmp_path = path.with_suffix(".tmp")
    with open(tmp_path, "w") as f:
        json.dump(payload, f, indent=2)
    tmp_path.replace(path)  # atomic on the same filesystem


async def run_pipeline(cfg: dict) -> dict:
    """Fetch every configured source, summarize with Claude, write to disk.
    Returns the payload that was written."""
    raw_models = await fetch_all_sources(cfg)
    result = summarize(raw_models, cfg.get("anthropic", {}))

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": result.get("summary"),
        "models": result.get("models", []),
    }

    storage_cfg = cfg.get("storage", {})
    output_path = _resolve_path(storage_cfg.get("output_path", "./data/models.json"))
    backup_dir = _resolve_path(storage_cfg.get("backup_dir", "./data/backups"))
    keep_backups = storage_cfg.get("keep_backups", 10)

    _atomic_write(output_path, payload, backup_dir, keep_backups)
    return payload
