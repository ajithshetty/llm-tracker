"""
Loads config.yaml fresh on every access (no caching) so that flipping
`features.enable_live_fetch` or editing sources takes effect without
restarting the server. Environment variables referenced as ${VAR_NAME}
inside the YAML are substituted at load time.
"""
import os
import re
from pathlib import Path
from functools import lru_cache

import yaml
from dotenv import load_dotenv

load_dotenv()  # picks up a .env file next to this project, if present

CONFIG_PATH = Path(os.environ.get("APP_CONFIG_PATH", "config.yaml")).resolve()
_ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def _substitute_env(value):
    if isinstance(value, str):
        def repl(m):
            return os.environ.get(m.group(1), "")
        return _ENV_PATTERN.sub(repl, value)
    if isinstance(value, dict):
        return {k: _substitute_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_substitute_env(v) for v in value]
    return value


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"Config file not found at {CONFIG_PATH}. "
            f"Set APP_CONFIG_PATH env var or place config.yaml next to the app."
        )
    with open(CONFIG_PATH, "r") as f:
        raw = yaml.safe_load(f)
    return _substitute_env(raw)


def get_config() -> dict:
    """Always re-reads from disk — cheap for a small YAML file, and means
    toggling enable_live_fetch takes effect on the very next request."""
    return load_config()


@lru_cache
def project_root() -> Path:
    return CONFIG_PATH.parent
