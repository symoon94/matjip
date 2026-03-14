from __future__ import annotations

import asyncio
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from restaurant_assistant.config import get_api_key, set_api_key
from restaurant_assistant.favorites import (
    add_favorite,
    list_favorites,
    remove_favorite,
)
from restaurant_assistant.models import ScoredPlace
from restaurant_assistant.ranking import rank_places
from restaurant_assistant.search import search_all_places

app = typer.Typer(help="카카오맵 기반 맛집 추천 CLI 도구")
config_app = typer.Typer(help="설정 관리")
fav_app = typer.Typer(help="즐겨찾기 관리")
app.add_typer(config_app, name="config")
app.add_typer(fav_app, name="fav")

console = Console()


@app.command()
def find(
    query: str = typer.Argument(..., help="검색어 (예: '강남 한식', '홍대 이탈리안')"),
    top: int = typer.Option(10, "--top", "-n", help="표시할 맛집 수"),
    pages: int = typer.Option(3, "--pages", "-p", help="검색할 최대 페이지 수"),
) -> None:
    """맛집을 검색하고 4단계 필터링으로 랭킹합니다."""
    if not get_api_key():
        console.print("[red]카카오 API 키가 설정되지 않았습니다.[/red]")
        console.print("설정: [bold]matjip config set-key <YOUR_API_KEY>[/bold]")
        raise typer.Exit(1)

    async def _run() -> list[ScoredPlace]:
        with console.status("[bold green]카카오맵에서 검색 중..."):
            places = await search_all_places(query, max_pages=pages)

        if not places:
            console.print("[yellow]검색 결과가 없습니다.[/yellow]")
            return []

        console.print(f"[dim]{len(places)}개 장소 발견. 리뷰 분석 중...[/dim]")

        with console.status("[bold green]리뷰 분석 및 랭킹 중..."):
            ranked = await rank_places(places, top_n=top)

        return ranked

    ranked = asyncio.run(_run())

    if not ranked:
        raise typer.Exit()

    _display_results(ranked, query)


def _display_results(ranked: list[ScoredPlace], query: str) -> None:
    table = Table(title=f"🍽️  맛집 랭킹: {query}", show_lines=True)
    table.add_column("#", style="bold", width=3)
    table.add_column("식당", style="bold cyan", max_width=25)
    table.add_column("카테고리", max_width=15)
    table.add_column("평점", justify="center", width=5)
    table.add_column("리뷰", justify="center", width=5)
    table.add_column("즐찾", justify="center", max_width=12)
    table.add_column("의심%", justify="center", width=5)
    table.add_column("점수", justify="right", width=6, style="bold yellow")
    table.add_column("근거", max_width=35)
    table.add_column("운영", max_width=20)
    table.add_column("주소", max_width=30, style="dim")
    table.add_column("링크", no_wrap=True)

    for i, sp in enumerate(ranked, 1):
        rating = f"{sp.review_summary.avg_rating:.1f}" if sp.review_summary else "-"
        review_count = str(sp.review_summary.review_count) if sp.review_summary else "-"

        # 즐찾 + 그룹명
        if sp.is_favorite:
            groups = ", ".join(sp.favorite_groups) if sp.favorite_groups else ""
            fav_mark = f"⭐ {groups}" if groups else "⭐"
        else:
            fav_mark = ""

        # 의심%
        if sp.suspicion_score > 0:
            color = "red" if sp.suspicion_score >= 50 else "yellow"
            suspicion = f"[{color}]{sp.suspicion_score:.0f}%[/{color}]"
        else:
            suspicion = ""

        # 근거
        breakdown = sp.score_breakdown.format() if sp.score_breakdown else ""

        # 운영시간
        hours = sp.review_summary.open_hours if sp.review_summary else ""
        # 주소 (도로명 우선, 없으면 지번)
        addr = sp.place.road_address or sp.place.address
        # 카카오맵 링크 (클릭 가능한 URL)
        link = f"https://place.map.kakao.com/{sp.place.id}"

        table.add_row(
            str(i),
            sp.place.name,
            sp.place.category.split(" > ")[-1] if " > " in sp.place.category else sp.place.category,
            rating,
            review_count,
            fav_mark,
            suspicion,
            f"{sp.score:.1f}",
            breakdown,
            hours,
            addr,
            link,
        )

    console.print()
    console.print(table)
    console.print()


# --- Config commands ---


@config_app.command("set-key")
def config_set_key(
    key: str = typer.Argument(..., help="카카오 REST API 키"),
) -> None:
    """카카오 REST API 키를 설정합니다."""
    set_api_key(key)
    console.print("[green]API 키가 저장되었습니다.[/green]")


@config_app.command("show")
def config_show() -> None:
    """현재 설정을 표시합니다."""
    key = get_api_key()
    if key:
        masked = key[:4] + "****" + key[-4:]
        console.print(f"카카오 API 키: {masked}")
    else:
        console.print("[yellow]API 키가 설정되지 않았습니다.[/yellow]")


# --- Favorites commands ---


@fav_app.command("add")
def fav_add(
    place_id: str = typer.Argument(..., help="장소 ID"),
    name: str = typer.Argument(..., help="장소 이름"),
    category: Optional[str] = typer.Argument(None, help="카테고리"),
) -> None:
    """즐겨찾기에 장소를 추가합니다."""
    add_favorite(place_id, name, category or "")
    console.print(f"[green]'{name}' 이(가) 즐겨찾기에 추가되었습니다.[/green]")


@fav_app.command("remove")
def fav_remove(
    place_id: str = typer.Argument(..., help="장소 ID"),
) -> None:
    """즐겨찾기에서 장소를 제거합니다."""
    if remove_favorite(place_id):
        console.print("[green]즐겨찾기에서 제거되었습니다.[/green]")
    else:
        console.print("[yellow]해당 장소를 찾을 수 없습니다.[/yellow]")


@fav_app.command("sync")
def fav_sync() -> None:
    """카카오맵에 로그인하여 즐겨찾기를 동기화합니다."""
    from restaurant_assistant.sync_favorites import run_sync

    try:
        favorites = run_sync()
        if favorites:
            table = Table(title="⭐ 동기화된 즐겨찾기")
            table.add_column("ID", style="dim")
            table.add_column("이름", style="bold")
            table.add_column("카테고리")
            table.add_column("그룹", style="dim")

            for f in favorites:
                table.add_row(f["id"], f["name"], f.get("category", ""), f.get("group", ""))

            console.print(table)
    except RuntimeError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1)


@fav_app.command("list")
def fav_list(
    search: Optional[str] = typer.Option(None, "--search", "-s", help="이름/카테고리/주소/폴더명으로 검색"),
    top: int = typer.Option(50, "--top", "-n", help="표시할 최대 수"),
) -> None:
    """즐겨찾기 목록을 표시합니다. 모든 폴더(구독 포함)의 합집합."""
    from restaurant_assistant.config import load_folder_names

    favorites = list_favorites()
    if not favorites:
        console.print("[dim]즐겨찾기가 비어 있습니다.[/dim]")
        return

    folder_names = load_folder_names()

    # 폴더명 매핑
    for f in favorites:
        f["_group_name"] = folder_names.get(f.get("group", ""), "")

    # 검색 필터
    if search:
        keyword = search.lower()
        ko_en = {
            "강남": "gangnam", "서초": "seocho", "송파": "songpa", "마포": "mapo",
            "종로": "jongno", "용산": "yongsan", "성동": "seongdong", "광진": "gwangjin",
            "동대문": "dongdaemun", "중랑": "jungnang", "성북": "seongbuk", "강북": "gangbuk",
            "도봉": "dobong", "노원": "nowon", "은평": "eunpyeong", "서대문": "seodaemun",
            "중구": "jung-gu", "동작": "dongjak", "관악": "gwanak", "금천": "geumcheon",
            "영등포": "yeongdeungpo", "구로": "guro", "양천": "yangcheon", "강서": "gangseo",
            "강동": "gangdong", "서울": "seoul", "부산": "busan", "인천": "incheon",
            "대구": "daegu", "대전": "daejeon", "광주": "gwangju", "수원": "suwon",
            "용인": "yongin", "성남": "seongnam", "제주": "jeju",
        }
        extra = [en for ko, en in ko_en.items() if ko in keyword]

        def _match(f: dict) -> bool:
            fields = [
                f.get("name", ""), f.get("category", ""),
                f.get("address", ""), f.get("_group_name", ""), f.get("memo", ""),
            ]
            fields_lower = [v.lower() for v in fields]
            return (
                any(keyword in v for v in fields_lower)
                or any(en in v for en in extra for v in fields_lower)
            )

        favorites = [f for f in favorites if _match(f)]

    if not favorites:
        console.print(f"[yellow]'{search}' 검색 결과가 없습니다.[/yellow]")
        return

    total = len(favorites)
    shown = favorites[:top]

    title = f"⭐ 즐겨찾기 ({total}개)"
    if search:
        title = f"⭐ 즐겨찾기 검색: '{search}' ({total}개)"

    table = Table(title=title)
    table.add_column("#", style="dim", width=4)
    table.add_column("이름", style="bold cyan", max_width=20, no_wrap=True)
    table.add_column("폴더", style="green", max_width=15, no_wrap=True)
    table.add_column("주소", max_width=25, no_wrap=True)
    table.add_column("메모", style="yellow", max_width=15, no_wrap=True)
    table.add_column("ID", style="dim", no_wrap=True)

    for i, f in enumerate(shown, 1):
        # 주소 간결화: "서울 강남구 봉은사로 12 1층 (역삼동)" → "강남구 봉은사로 12"
        addr = f.get("address", "")
        # 괄호 부분 제거, 층수 제거
        if "(" in addr:
            addr = addr[:addr.index("(")].strip()
        parts = addr.split()
        if len(parts) > 1 and parts[0] in ("서울", "경기", "인천", "부산", "대구", "대전", "광주", "울산", "세종",
                                             "강원특별자치도", "충북", "충남", "전북특별자치도", "전남", "경북", "경남", "제주특별자치도"):
            addr = " ".join(parts[1:])

        table.add_row(
            str(i),
            f["name"],
            f["_group_name"],
            addr,
            f.get("memo", ""),
            f["id"],
        )

    console.print()
    console.print(table)
    if total > top:
        console.print(f"[dim]... 외 {total - top}개 더 있음. --top {total} 으로 전체 보기[/dim]")
    console.print()


if __name__ == "__main__":
    app()
