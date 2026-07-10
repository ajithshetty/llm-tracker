from typing import Optional, List
from pydantic import BaseModel


class ModelEntry(BaseModel):
    id: str
    name: str
    provider: str
    release: str
    release_approx: bool = False
    context: int
    price_in: Optional[float] = None
    price_out: Optional[float] = None
    open_weights: bool = False
    hf_repo: Optional[str] = None
    hf_downloads: Optional[int] = None
    hf_likes: Optional[int] = None
    hf_status: str = "n/a"  # "success" | "error" | "n/a"


class ModelsPayload(BaseModel):
    generated_at: str
    summary: Optional[str] = None
    models: List[ModelEntry]


class StatusResponse(BaseModel):
    live_fetch_enabled: bool
    last_updated: Optional[str] = None
    model_count: int = 0


class FetchLiveResponse(BaseModel):
    ok: bool
    generated_at: str
    model_count: int
    message: str
