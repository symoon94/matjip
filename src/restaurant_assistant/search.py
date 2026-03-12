from __future__ import annotations

import httpx

from restaurant_assistant.config import get_api_key
from restaurant_assistant.models import Place

KEYWORD_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
CATEGORY_FD6 = "FD6"  # 음식점


async def search_places(
    query: str,
    *,
    page: int = 1,
    size: int = 15,
    sort: str = "accuracy",
) -> tuple[list[Place], bool]:
    """카카오 로컬 API로 장소를 검색한다.

    Returns:
        (places, has_next) 튜플
    """
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("카카오 API 키가 설정되지 않았습니다. `matjip config set-key <KEY>` 로 설정하세요.")

    params = {
        "query": query,
        "category_group_code": CATEGORY_FD6,
        "page": page,
        "size": size,
        "sort": sort,
    }

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            KEYWORD_SEARCH_URL,
            params=params,
            headers={"Authorization": f"KakaoAK {api_key}"},
        )
        resp.raise_for_status()
        data = resp.json()

    places = [
        Place(
            id=doc["id"],
            name=doc["place_name"],
            category=doc.get("category_name", ""),
            address=doc.get("address_name", ""),
            road_address=doc.get("road_address_name", ""),
            phone=doc.get("phone", ""),
            url=doc.get("place_url", ""),
            x=float(doc["x"]),
            y=float(doc["y"]),
            distance=int(doc["distance"]) if doc.get("distance") else None,
        )
        for doc in data.get("documents", [])
    ]

    has_next = not data.get("meta", {}).get("is_end", True)
    return places, has_next


async def search_all_places(query: str, *, max_pages: int = 3) -> list[Place]:
    """여러 페이지를 순회하며 검색 결과를 모은다."""
    all_places: list[Place] = []
    for page in range(1, max_pages + 1):
        places, has_next = await search_places(query, page=page)
        all_places.extend(places)
        if not has_next:
            break
    return all_places
