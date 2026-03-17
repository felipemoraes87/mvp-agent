from __future__ import annotations

import os
from pathlib import Path


def read_env_value(*names: str, default: str | None = None) -> str | None:
    for name in names:
        file_value = os.getenv(f"{name}_FILE")
        if file_value:
            path = Path(file_value).expanduser()
            if path.is_file():
                return path.read_text(encoding="utf-8").strip()

        value = os.getenv(name)
        if value is not None and value != "":
            return value

    return default
