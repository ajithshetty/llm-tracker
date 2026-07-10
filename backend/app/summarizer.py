"""
Sends the raw, freshly-fetched model data to Claude and asks it to return a
cleaned, normalized JSON payload plus a short plain-English summary of what
changed or stands out. Claude is not asked to invent any numbers — only to
tidy up, dedupe, and describe the data it's given.
"""
import json
import re

from anthropic import Anthropic, APIError

SYSTEM_PROMPT = """You are a data-normalization assistant for an LLM release tracking \
dashboard. You will be given a JSON array of model records gathered from real \
sources (Hugging Face API results for open-weight models, and a maintained \
static list for closed models).

Your job:
1. Return the SAME records, cleaned up: consistent field names, no duplicates, \
sorted by `release` date ascending.
2. Never invent, estimate, or fill in a number that was null/missing in the \
input. Leave it null. Do not add fields like "estimated_users" that were not \
in the source data.
3. Write a 2-4 sentence plain-English `summary` noting anything notable in \
THIS data (e.g. which model is newest, which open-weight model has the most \
downloads, any fetch errors present in the input).

Respond with ONLY a JSON object of the exact shape:
{"summary": "...", "models": [ {...same fields as input...}, ... ]}
No markdown fences, no commentary outside the JSON."""


def _extract_json(text: str) -> dict:
    text = text.strip()
    # Strip ```json ... ``` fences if Claude adds them despite instructions
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    return json.loads(text)


def summarize(raw_models: list[dict], anthropic_cfg: dict) -> dict:
    api_key = anthropic_cfg.get("api_key")
    if not api_key:
        raise RuntimeError(
            "No Anthropic API key configured. Set ANTHROPIC_API_KEY in your "
            "environment (referenced as ${ANTHROPIC_API_KEY} in config.yaml)."
        )

    client = Anthropic(api_key=api_key)
    model = anthropic_cfg.get("model", "claude-sonnet-5")
    max_tokens = anthropic_cfg.get("max_tokens", 4000)

    try:
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": json.dumps(raw_models)}],
        )
    except APIError as exc:
        raise RuntimeError(f"Anthropic API call failed: {exc}") from exc

    text = "".join(block.text for block in response.content if block.type == "text")
    try:
        parsed = _extract_json(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"Claude did not return valid JSON, refusing to write bad data: {exc}"
        ) from exc

    if "models" not in parsed:
        raise RuntimeError("Claude's response was missing a `models` field.")
    return parsed
