from __future__ import annotations

import json
from pathlib import Path

CONFIG_DIR = Path.home() / ".matjip"
CONFIG_FILE = CONFIG_DIR / "config.json"
FAVORITES_FILE = CONFIG_DIR / "favorites.json"
FOLDER_NAMES_FILE = CONFIG_DIR / "folder_names.json"


def ensure_config_dir() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def load_config() -> dict:
    ensure_config_dir()
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text())
    return {}


def save_config(config: dict) -> None:
    ensure_config_dir()
    CONFIG_FILE.write_text(json.dumps(config, indent=2, ensure_ascii=False))


def get_api_key() -> str | None:
    return load_config().get("kakao_api_key")


def set_api_key(key: str) -> None:
    config = load_config()
    config["kakao_api_key"] = key
    save_config(config)


def load_favorites() -> list[dict]:
    ensure_config_dir()
    if FAVORITES_FILE.exists():
        return json.loads(FAVORITES_FILE.read_text())
    return []


def save_favorites(favorites: list[dict]) -> None:
    ensure_config_dir()
    FAVORITES_FILE.write_text(json.dumps(favorites, indent=2, ensure_ascii=False))


def load_folder_names() -> dict[str, str]:
    ensure_config_dir()
    if FOLDER_NAMES_FILE.exists():
        return json.loads(FOLDER_NAMES_FILE.read_text())
    return {}


def save_folder_names(names: dict[str, str]) -> None:
    ensure_config_dir()
    FOLDER_NAMES_FILE.write_text(json.dumps(names, indent=2, ensure_ascii=False))
