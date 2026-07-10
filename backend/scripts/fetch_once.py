"""
Runs the same pipeline as POST /api/fetch-live, but headless — no server
needed. Used by the GitHub Actions workflow to refresh data/models.json on
a schedule (or on manual dispatch) without requiring an always-on backend.

Usage:
    ANTHROPIC_API_KEY=sk-ant-... python scripts/fetch_once.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_config
from app.pipeline import run_pipeline


async def main():
    cfg = get_config()
    if not cfg.get("features", {}).get("enable_live_fetch", False):
        print("features.enable_live_fetch is false in config.yaml — refusing to run. "
              "Set it to true if you want scheduled/CI refreshes.")
        sys.exit(1)

    payload = await run_pipeline(cfg)
    print(f"Wrote {len(payload['models'])} models, generated_at={payload['generated_at']}")


if __name__ == "__main__":
    asyncio.run(main())
