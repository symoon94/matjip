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
def fav_list() -> None:
    """즐겨찾기 목록을 표시합니다."""
    favorites = list_favorites()
    if not favorites:
        console.print("[dim]즐겨찾기가 비어 있습니다.[/dim]")
        return

    table = Table(title="⭐ 즐겨찾기")
    table.add_column("ID", style="dim")
    table.add_column("이름", style="bold")
    table.add_column("카테고리")

    for f in favorites:
        table.add_row(f["id"], f["name"], f.get("category", ""))

    console.print(table)


if __name__ == "__main__":
    app()
