from __future__ import annotations

from restaurant_assistant.config import load_favorites, save_favorites
from restaurant_assistant.models import Place


def add_favorite(place_id: str, place_name: str, category: str = "") -> None:
    """즐겨찾기에 장소를 추가한다."""
    favorites = load_favorites()
    if any(f["id"] == place_id for f in favorites):
        return
    favorites.append({"id": place_id, "name": place_name, "category": category})
    save_favorites(favorites)


def remove_favorite(place_id: str) -> bool:
    """즐겨찾기에서 장소를 제거한다."""
    favorites = load_favorites()
    new_favorites = [f for f in favorites if f["id"] != place_id]
    if len(new_favorites) == len(favorites):
        return False
    save_favorites(new_favorites)
    return True


def list_favorites() -> list[dict]:
    """저장된 즐겨찾기 목록을 반환한다."""
    return load_favorites()


def is_favorite(place_id: str) -> bool:
    """해당 장소가 즐겨찾기에 포함되어 있는지 확인한다."""
    return any(f["id"] == place_id for f in load_favorites())


def match_favorites(places: list[Place]) -> set[str]:
    """장소 목록에서 즐겨찾기에 포함된 장소 ID 집합을 반환한다."""
    fav_ids = {f["id"] for f in load_favorites()}
    return {p.id for p in places if p.id in fav_ids}


def match_favorites_with_groups(places: list[Place]) -> dict[str, list[str]]:
    """장소 목록에서 즐겨찾기에 포함된 장소의 그룹 이름 목록을 반환한다.

    Returns:
        {place_id: [그룹이름1, 그룹이름2, ...]} 매핑
    """
    from restaurant_assistant.config import load_folder_names

    favorites = load_favorites()
    folder_names = load_folder_names()
    place_ids = {p.id for p in places}

    result: dict[str, list[str]] = {}
    for fav in favorites:
        fav_id = fav["id"]
        if fav_id not in place_ids:
            continue
        group_id = fav.get("group", "")
        group_name = folder_names.get(group_id, "")
        if fav_id not in result:
            result[fav_id] = []
        if group_name and group_name not in result[fav_id]:
            result[fav_id].append(group_name)

    return result
