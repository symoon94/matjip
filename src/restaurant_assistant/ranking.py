from __future__ import annotations

import asyncio
import math
import ssl

import httpx

from restaurant_assistant.fake_review import analyze_fake_reviews
from restaurant_assistant.favorites import match_favorites, match_favorites_with_groups
from restaurant_assistant.models import FakeReviewResult, Place, ReviewSummary, ScoreBreakdown, ScoredPlace
from restaurant_assistant.reviews import fetch_review_summary, filter_by_reviews

# 스코어링 가중치
# 즐겨찾기가 최우선: 즐찾 식당은 항상 비즐찾보다 위에 오도록 100점 가산
WEIGHT_FAVORITE = 100.0
# 그 다음 리뷰 품질 순
WEIGHT_RATING = 30.0
WEIGHT_REVIEW_COUNT = 20.0
WEIGHT_FAKE_PENALTY = -20.0

_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE


async def rank_places(places: list[Place], *, top_n: int = 10) -> list[ScoredPlace]:
    """장소 목록에 4단계 파이프라인을 적용하여 랭킹한다.

    1. 즐겨찾기 매칭
    2. 리뷰 필터링 (5개 이상, 4.0점 이상)
    3. 가짜 후기 탐지
    4. 종합 스코어링
    """
    fav_ids = match_favorites(places)
    fav_groups = match_favorites_with_groups(places)

    # 리뷰 데이터를 병렬로 가져오기 (클라이언트 공유로 커넥션 재사용)
    sem = asyncio.Semaphore(5)  # 동시 요청 제한

    async def _fetch(client: httpx.AsyncClient, place_id: str) -> ReviewSummary | None:
        async with sem:
            return await fetch_review_summary(place_id, client=client)

    async with httpx.AsyncClient(verify=_ssl_ctx, timeout=10) as client:
        tasks = [_fetch(client, p.id) for p in places]
        summaries: list[ReviewSummary | None] = await asyncio.gather(*tasks)

    scored: list[ScoredPlace] = []
    for place, summary in zip(places, summaries):
        if summary is None:
            continue

        # Step 2: 리뷰 필터링
        passes_review = filter_by_reviews(summary)

        # Step 3: 가짜 후기 탐지
        fake_result = analyze_fake_reviews(summary.reviews) if summary.reviews else FakeReviewResult()

        # Step 4: 스코어링
        is_fav = place.id in fav_ids
        groups = fav_groups.get(place.id, [])
        score, breakdown = _calculate_score(summary, is_fav, len(fake_result.flags), passes_review)

        scored.append(
            ScoredPlace(
                place=place,
                review_summary=summary,
                is_favorite=is_fav,
                fake_review_flags=fake_result.flags,
                score=score,
                favorite_groups=groups,
                suspicion_score=fake_result.suspicion_score,
                score_breakdown=breakdown,
            )
        )

    # 즐겨찾기 우선, 그 안에서 점수 순
    scored.sort(key=lambda s: (s.is_favorite, s.score), reverse=True)
    return scored[:top_n]


def _calculate_score(
    summary: ReviewSummary,
    is_favorite: bool,
    fake_flag_count: int,
    passes_review_filter: bool,
) -> tuple[float, ScoreBreakdown]:
    breakdown = ScoreBreakdown()

    # 리뷰 기준 미충족 시 큰 감점
    if not passes_review_filter:
        breakdown.review_filter_penalty = -50.0

    # 평점 점수 (4.0~5.0 → 0~30점)
    breakdown.rating = max(0, (summary.avg_rating - 4.0)) * WEIGHT_RATING

    # 리뷰 수 점수 (로그 스케일, 최대 20점)
    breakdown.review_count = min(WEIGHT_REVIEW_COUNT, math.log1p(summary.review_count) * 4)

    # 즐겨찾기 가산점
    if is_favorite:
        breakdown.favorite = WEIGHT_FAVORITE

    # 가짜 후기 감점
    breakdown.fake_penalty = fake_flag_count * WEIGHT_FAKE_PENALTY

    score = (
        breakdown.favorite
        + breakdown.rating
        + breakdown.review_count
        + breakdown.fake_penalty
        + breakdown.review_filter_penalty
    )
    return round(score, 1), breakdown
