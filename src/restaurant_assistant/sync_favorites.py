from __future__ import annotations

import asyncio
import json

from playwright.async_api import async_playwright

from restaurant_assistant.config import CONFIG_DIR, save_favorites, save_folder_names

KAKAO_MAP_URL = "https://map.kakao.com/"


async def sync_favorites_from_kakao() -> list[dict]:
    """카카오맵에 로그인하여 즐겨찾기 목록을 동기화한다."""
    storage_path = CONFIG_DIR / "kakao_auth.json"

    async with async_playwright() as p:
        ctx_opts: dict = {
            "viewport": {"width": 1280, "height": 800},
            "user_agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
        }
        if storage_path.exists():
            ctx_opts["storage_state"] = str(storage_path)

        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(**ctx_opts)
        page = await context.new_page()

        await page.goto(KAKAO_MAP_URL, wait_until="networkidle", timeout=30000)

        if not await _is_logged_in(page):
            print("\n브라우저에서 카카오 계정으로 로그인해주세요.")
            print("로그인이 완료되면 자동으로 즐겨찾기를 가져옵니다. (최대 3분 대기)\n")

            await page.goto(
                "https://accounts.kakao.com/login/?continue=https://map.kakao.com/"
            )

            logged_in = False
            for _ in range(90):
                await page.wait_for_timeout(2000)
                if "map.kakao.com" in page.url and "accounts.kakao.com" not in page.url:
                    await page.wait_for_timeout(2000)
                    if await _is_logged_in(page):
                        logged_in = True
                        break
            if not logged_in:
                await browser.close()
                raise RuntimeError("로그인 시간이 초과되었습니다.")

        print("로그인 확인 완료!")
        await context.storage_state(path=str(storage_path))

        # 1) 폴더 목록 조회
        folder_ids, folder_names = await _fetch_folders(page)
        print(f"즐겨찾기 폴더 {len(folder_ids)}개 발견")

        # 폴더 이름이 없으면 UI에서 캡처 시도
        if not folder_names:
            folder_names = await _fetch_folder_names_from_ui(page)

        # 2) 전체 즐겨찾기 항목 조회
        favorites = await _fetch_favorites(page, folder_ids, folder_names)

        await browser.close()

    if favorites:
        save_favorites(favorites)
        print(f"{len(favorites)}개의 즐겨찾기를 동기화했습니다.")
    else:
        print("즐겨찾기가 비어 있습니다.")

    # 폴더 이름 저장
    if folder_names:
        save_folder_names(folder_names)

    return favorites


async def _fetch_folders(page) -> tuple[list[int], dict[str, str]]:
    """timestamp API에서 폴더 ID 목록과 이름을 가져온다."""
    raw = await page.evaluate("""
        async () => {
            const r = await fetch('/favorite/timestamp.json');
            return await r.text();
        }
    """)
    try:
        data = json.loads(raw)
        timestamps = data.get("folder_timestamps", [])
        folder_ids = [t["folderid"] for t in timestamps if "folderid" in t]
        # 폴더 이름 추출 시도
        folder_names: dict[str, str] = {}
        for t in timestamps:
            fid = str(t.get("folderid", ""))
            fname = t.get("name", "") or t.get("title", "") or t.get("folder_name", "")
            if fid and fname:
                folder_names[fid] = fname
        return folder_ids, folder_names
    except (json.JSONDecodeError, KeyError):
        return [0], {}


async def _fetch_folder_names_from_ui(page) -> dict[str, str]:
    """Playwright로 즐겨찾기 패널에서 폴더 이름을 캡처한다."""
    try:
        # MY 탭 클릭
        await page.evaluate("document.querySelector('#search\\\\.tab5')?.click()")
        await page.wait_for_timeout(2000)

        # 즐겨찾기 더보기 클릭
        await page.evaluate("""
            document.querySelector('#info\\\\.main\\\\.favorite .link_myfavorite')?.click()
        """)
        await page.wait_for_timeout(2000)

        # 폴더 목록 추출: 각 li.FavoriteDirectoryItem 안의
        # input.inp_directory[value] → 폴더 ID, .txt_directory → 폴더 이름
        names = await page.evaluate("""
            () => {
                const result = {};
                const items = document.querySelectorAll('li.FavoriteDirectoryItem');
                items.forEach(li => {
                    const input = li.querySelector('input.inp_directory');
                    const nameEl = li.querySelector('.txt_directory');
                    const id = input ? input.value : '';
                    const name = nameEl ? nameEl.textContent.trim() : '';
                    if (id && name) result[id] = name;
                });
                return result;
            }
        """)
        return names or {}
    except Exception:
        return {}


async def _fetch_favorites(page, folder_ids: list[int], folder_names: dict[str, str] | None = None) -> list[dict]:
    """list.json API로 즐겨찾기 항목을 가져온다."""
    # folderIds 쿼리 파라미터 구성
    params = "&".join(f"folderIds%5B%5D={fid}" for fid in folder_ids)
    url = f"/favorite/list.json?{params}&type=M"

    raw = await page.evaluate(
        """
        async (url) => {
            const r = await fetch(url);
            return await r.text();
        }
    """,
        url,
    )

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []

    if isinstance(data.get("status"), dict) and data["status"].get("code") != "SUCCESS":
        return []

    results = data.get("result", [])
    favorites: list[dict] = []
    seen_ids: set[str] = set()

    for item in results:
        if item.get("favoriteType") != "PLACE":
            continue

        place_id = str(item.get("key", ""))
        name = item.get("display1", "")

        if not place_id or not name or place_id in seen_ids:
            continue

        seen_ids.add(place_id)

        group_id = str(item.get("folderId", ""))
        fav: dict = {
            "id": place_id,
            "name": name,
            "category": item.get("catename", ""),
            "group": group_id,
            "group_name": (folder_names or {}).get(group_id, ""),
            "address": item.get("display2", ""),
            "memo": item.get("memo", ""),
        }
        # lon/lat = WGS84 좌표 (x/y는 카텍 좌표이므로 사용 안 함)
        lon = item.get("lon")
        lat = item.get("lat")
        if lon and lat:
            fav["x"] = float(lon)
            fav["y"] = float(lat)

        favorites.append(fav)

    return favorites


async def _is_logged_in(page) -> bool:
    try:
        result = await page.evaluate("""
            async () => {
                try {
                    const r = await fetch('/favorite/timestamp.json');
                    const text = await r.text();
                    return text.includes('SUCCESS');
                } catch {
                    return false;
                }
            }
        """)
        return result
    except Exception:
        return False


def run_sync() -> list[dict]:
    return asyncio.run(sync_favorites_from_kakao())
