from __future__ import annotations

import ssl
from datetime import date, datetime

import httpx

from restaurant_assistant.models import Review, ReviewSummary

PANEL3_URL = "https://place-api.map.kakao.com/places/panel3/{place_id}"
REVIEWS_URL = "https://place-api.map.kakao.com/places/tab/reviews/kakaomap/{place_id}"

_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://place.map.kakao.com/",
    "Accept": "application/json, text/plain, */*",
    "pf": "PC",
    "appversion": "6.6.0",
}


async def fetch_review_summary(
    place_id: str,
    client: httpx.AsyncClient | None = None,
    max_reviews: int = 60,
) -> ReviewSummary | None:
    """panel3 API에서 평점/리뷰수를, reviews API에서 리뷰 목록을 가져온다."""
    should_close = client is None
    if client is None:
        client = httpx.AsyncClient(verify=_ssl_ctx, timeout=10)

    try:
        # 1) panel3에서 평점/리뷰수 조회
        resp = await client.get(
            PANEL3_URL.format(place_id=place_id),
            headers=_HEADERS,
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        kr = data.get("kakaomap_review", {})
        score_set = kr.get("score_set", {})

        avg_rating = float(score_set.get("average_score", 0))
        review_count = int(score_set.get("review_count", 0))

        # 운영시간 파싱
        oh = data.get("open_hours", {})
        headline = oh.get("headline", {})
        open_hours = headline.get("display_text", "")
        info = headline.get("display_text_info", "")
        if info:
            open_hours = f"{open_hours} ({info})" if open_hours else info

        # 2) reviews API에서 개별 리뷰 조회
        reviews: list[Review] = []
        seen_ids: set[str] = set()

        # 파라미터 없이 호출 (일부 장소는 params 넣으면 400)
        review_url = REVIEWS_URL.format(place_id=place_id)
        resp2 = await client.get(review_url, headers=_HEADERS)
        if resp2.status_code == 200:
            review_data = resp2.json()
            for item in review_data.get("reviews", []):
                review_id = str(item.get("review_id", ""))
                if review_id and review_id in seen_ids:
                    continue
                if review_id:
                    seen_ids.add(review_id)
                owner = item.get("meta", {}).get("owner", {})
                reviews.append(
                    Review(
                        nickname=owner.get("nickname", ""),
                        rating=float(item.get("star_rating", 0)),
                        text=item.get("contents", ""),
                        date=_parse_date(item.get("registered_at", item.get("updated_at", ""))),
                        photo_count=int(item.get("photo_count", 0)),
                        reviewer_review_count=owner.get("review_count"),
                        reviewer_follower_count=owner.get("follower_count"),
                        reviewer_avg_score=owner.get("average_score"),
                    )
                )

        return ReviewSummary(
            place_id=place_id,
            avg_rating=avg_rating,
            review_count=review_count,
            reviews=reviews,
            open_hours=open_hours,
        )
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    finally:
        if should_close:
            await client.aclose()


def filter_by_reviews(summary: ReviewSummary, min_count: int = 10, min_rating: float = 4.0) -> bool:
    """리뷰 수와 평점 기준을 충족하는지 확인한다."""
    return summary.review_count >= min_count and summary.avg_rating >= min_rating


def _parse_date(date_str: str) -> date:
    if not date_str:
        return date.today()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y.%m.%d.", "%Y.%m.%d"):
        try:
            return datetime.strptime(date_str.strip(), fmt).date()
        except ValueError:
            continue
    return date.today()
