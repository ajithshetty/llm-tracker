"""
Connects to configured sources and returns raw, unsummarized model data.

Currently supports:
  - Hugging Face public API (live download/like counts for open-weight models)
  - a static list maintained in config.yaml (for closed, API-only models where
    no usage-data source exists)

Add a new source by writing a `fetch_x(cfg) -> list[dict]` function and
wiring it into `fetch_all_sources`.
"""
import asyncio
import httpx


async def _fetch_one_hf_repo(client: httpx.AsyncClient, base_url: str, entry: dict) -> dict:
    repo = entry["repo"]
    out = {
        "id": entry["id"],
        "name": entry["name"],
        "provider": entry["provider"],
        "release": entry["release"],
        "context": entry["context"],
        "price_in": entry.get("price_in"),
        "price_out": entry.get("price_out"),
        "open_weights": True,
        "hf_repo": repo,
        "hf_downloads": None,
        "hf_likes": None,
        "hf_status": "error",
    }
    try:
        resp = await client.get(f"{base_url}/{repo}")
        resp.raise_for_status()
        data = resp.json()
        out["hf_downloads"] = data.get("downloads")
        out["hf_likes"] = data.get("likes")
        out["hf_status"] = "success"
    except Exception as exc:  # noqa: BLE001 — surface as per-item failure, don't crash the run
        out["hf_status"] = "error"
        out["hf_error"] = str(exc)
    return out


async def fetch_huggingface(cfg: dict) -> list[dict]:
    hf_cfg = cfg.get("sources", {}).get("huggingface", {})
    repos = hf_cfg.get("repos", [])
    if not repos:
        return []
    base_url = hf_cfg.get("base_url", "https://huggingface.co/api/models")
    timeout = hf_cfg.get("timeout_seconds", 15)
    async with httpx.AsyncClient(timeout=timeout) as client:
        results = await asyncio.gather(
            *[_fetch_one_hf_repo(client, base_url, entry) for entry in repos]
        )
    return list(results)


def fetch_static_models(cfg: dict) -> list[dict]:
    static_cfg = cfg.get("sources", {}).get("static_models", [])
    out = []
    for entry in static_cfg:
        out.append({
            "id": entry["id"],
            "name": entry["name"],
            "provider": entry["provider"],
            "release": entry["release"],
            "context": entry["context"],
            "price_in": entry.get("price_in"),
            "price_out": entry.get("price_out"),
            "open_weights": False,
            "hf_repo": None,
            "hf_downloads": None,
            "hf_likes": None,
            "hf_status": "n/a",
        })
    return out


async def fetch_all_sources(cfg: dict) -> list[dict]:
    hf_models = await fetch_huggingface(cfg)
    static_models = fetch_static_models(cfg)
    return hf_models + static_models
