from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import timedelta

from restaurant_assistant.models import FakeReviewFlag, FakeReviewResult, Review


def detect_fake_reviews(reviews: list[Review]) -> list[FakeReviewFlag]:
    """규칙 기반으로 가짜 후기를 탐지한다."""
    flags: list[FakeReviewFlag] = []

    flag = _check_same_date_cluster(reviews)
    if flag:
        flags.append(flag)

    flag = _check_similar_nicknames(reviews)
    if flag:
        flags.append(flag)

    flag = _check_short_period_burst(reviews)
    if flag:
        flags.append(flag)

    return flags


def _check_same_date_cluster(reviews: list[Review], threshold: int = 3) -> FakeReviewFlag | None:
    """같은 날짜에 5점 리뷰가 threshold개 이상이면 의심."""
    by_date: dict[str, list[Review]] = defaultdict(list)
    for r in reviews:
        if r.rating >= 5.0:
            by_date[str(r.date)].append(r)

    suspicious: list[Review] = []
    for date_str, date_reviews in by_date.items():
        if len(date_reviews) >= threshold:
            suspicious.extend(date_reviews)

    if suspicious:
        dates = sorted({str(r.date) for r in suspicious})
        return FakeReviewFlag(
            reason=f"같은 날짜에 5점 리뷰 집중: {', '.join(dates)}",
            suspicious_reviews=suspicious,
        )
    return None


def _check_similar_nicknames(reviews: list[Review], threshold: int = 3) -> FakeReviewFlag | None:
    """비슷한 패턴의 닉네임에서 5점 리뷰가 다수이면 의심.
    닉네임을 정규화하여 유사 패턴을 그룹화한다."""
    five_star = [r for r in reviews if r.rating >= 5.0]
    if len(five_star) < threshold:
        return None

    patterns: dict[str, list[Review]] = defaultdict(list)
    for r in five_star:
        key = _normalize_nickname(r.nickname)
        patterns[key].append(r)

    suspicious: list[Review] = []
    for key, group in patterns.items():
        if len(group) >= threshold:
            suspicious.extend(group)

    if suspicious:
        return FakeReviewFlag(
            reason="유사 닉네임 패턴에서 5점 리뷰 다수 발견",
            suspicious_reviews=suspicious,
        )
    return None


def _check_short_period_burst(
    reviews: list[Review], days: int = 7, threshold: int = 5
) -> FakeReviewFlag | None:
    """짧은 기간(days일) 내에 5점 리뷰가 threshold개 이상 집중되면 의심."""
    five_star = sorted([r for r in reviews if r.rating >= 5.0], key=lambda r: r.date)
    if len(five_star) < threshold:
        return None

    for i in range(len(five_star) - threshold + 1):
        window = five_star[i : i + threshold]
        if (window[-1].date - window[0].date) <= timedelta(days=days):
            return FakeReviewFlag(
                reason=f"{days}일 내 5점 리뷰 {threshold}개 이상 집중",
                suspicious_reviews=window,
            )
    return None


def _normalize_nickname(nickname: str) -> str:
    """닉네임에서 숫자와 특수문자를 제거하여 패턴을 추출한다."""
    cleaned = re.sub(r"[0-9_\-\.]+", "", nickname).strip().lower()
    if len(cleaned) <= 1:
        return nickname.lower()
    return cleaned


def _check_low_credibility_reviewers(
    reviews: list[Review], threshold: int = 3
) -> FakeReviewFlag | None:
    """저신뢰 계정(리뷰 1~2개, 팔로워 0, 평균 4.8+)에서 5점 리뷰 탐지."""
    suspicious: list[Review] = []
    for r in reviews:
        if r.rating < 5.0:
            continue
        if r.reviewer_review_count is None:
            continue
        if (
            r.reviewer_review_count <= 2
            and r.reviewer_follower_count == 0
            and r.reviewer_avg_score is not None
            and r.reviewer_avg_score >= 4.8
        ):
            suspicious.append(r)

    if len(suspicious) >= threshold:
        return FakeReviewFlag(
            reason="저신뢰 계정(리뷰 1~2개, 팔로워 0, 평균 4.8+)에서 5점 리뷰 다수",
            suspicious_reviews=suspicious,
        )
    return None


def _check_three_char_nickname_cluster(
    reviews: list[Review], threshold: int = 4
) -> FakeReviewFlag | None:
    """세글자 한글 닉네임에서 5점 리뷰 집중 탐지."""
    suspicious: list[Review] = []
    for r in reviews:
        if r.rating < 5.0:
            continue
        nick = r.nickname
        if len(nick) == 3 and all('\uac00' <= c <= '\ud7a3' for c in nick):
            suspicious.append(r)

    if len(suspicious) >= threshold:
        return FakeReviewFlag(
            reason="세글자 닉네임에서 5점 리뷰 집중",
            suspicious_reviews=suspicious,
        )
    return None


def _check_perfect_avg_score_reviewers(
    reviews: list[Review], threshold: int = 3
) -> FakeReviewFlag | None:
    """별점평균 5.0인 리뷰어가 5점 리뷰를 다수 남긴 경우 탐지."""
    suspicious: list[Review] = []
    for r in reviews:
        if r.rating < 5.0:
            continue
        if r.reviewer_avg_score is not None and r.reviewer_avg_score >= 5.0:
            suspicious.append(r)

    if len(suspicious) >= threshold:
        return FakeReviewFlag(
            reason=f"별점평균 5.0 리뷰어 {len(suspicious)}명이 5점 리뷰",
            suspicious_reviews=suspicious,
        )
    return None


def _check_perfect_score_date_cluster(
    reviews: list[Review], window_days: int = 2, threshold: int = 2
) -> FakeReviewFlag | None:
    """별점평균 5.0 리뷰어의 5점 리뷰가 1~2일 내 cluster로 몰리면 조작 확정.

    날짜별로 분산되어 있어도 window_days 이내에 threshold명 이상
    평균5.0 리뷰어가 5점을 남기면 플래그.
    """
    candidates = sorted(
        [
            r for r in reviews
            if r.rating >= 5.0
            and r.reviewer_avg_score is not None
            and r.reviewer_avg_score >= 5.0
        ],
        key=lambda r: r.date,
    )
    if len(candidates) < threshold:
        return None

    suspicious: list[Review] = []
    cluster_dates: list[str] = []

    for i in range(len(candidates) - threshold + 1):
        window = candidates[i : i + threshold]
        if (window[-1].date - window[0].date) <= timedelta(days=window_days):
            for r in window:
                if r not in suspicious:
                    suspicious.append(r)
            cluster_dates.append(str(window[0].date))

    if suspicious:
        dates_str = ", ".join(sorted(set(cluster_dates)))
        return FakeReviewFlag(
            reason=f"평균5.0 리뷰어 5점 날짜 집중 ({dates_str}, {len(suspicious)}명)",
            suspicious_reviews=suspicious,
        )
    return None


def _check_fake_review_mention(
    reviews: list[Review],
) -> FakeReviewFlag | None:
    """다른 리뷰어가 후기 알바/리뷰 알바를 언급한 경우 탐지."""
    keywords = [
        "후기 알바", "후기알바", "리뷰 알바", "리뷰알바",
        "광고 리뷰", "광고리뷰", "돈 받고", "돈받고",
        "협찬 리뷰", "협찬리뷰", "알바 리뷰", "알바리뷰",
        "가짜 리뷰", "가짜리뷰", "조작 리뷰", "조작리뷰",
        "별점 조작", "별점조작", "리뷰 조작", "리뷰조작",
    ]
    suspicious: list[Review] = []
    for r in reviews:
        text = r.text.lower()
        if any(kw in text for kw in keywords):
            suspicious.append(r)

    if suspicious:
        return FakeReviewFlag(
            reason=f"후기 알바 언급 리뷰 {len(suspicious)}건",
            suspicious_reviews=suspicious,
        )
    return None


def _check_no_photo_five_star_ratio(
    reviews: list[Review],
) -> FakeReviewFlag | None:
    """사진 없는 5점 리뷰 비율이 70% 이상이고 5점 리뷰가 5개 이상이면 의심."""
    five_star = [r for r in reviews if r.rating >= 5.0]
    if len(five_star) < 5:
        return None

    no_photo = [r for r in five_star if r.photo_count == 0]
    ratio = len(no_photo) / len(five_star) * 100

    if ratio >= 70:
        return FakeReviewFlag(
            reason=f"사진 없는 5점 리뷰 비율 {ratio:.0f}%",
            suspicious_reviews=no_photo,
        )
    return None


# 의심 점수 가중치
_SUSPICION_WEIGHTS = {
    "날짜 집중": 35,
    "후기 알바 언급": 30,
    "같은 날짜": 25,
    "별점평균 5.0 리뷰어": 20,
    "닉네임": 20,
    "일 내": 20,
    "저신뢰": 15,
    "세글자": 10,
    "사진": 10,
}


def analyze_fake_reviews(reviews: list[Review]) -> FakeReviewResult:
    """기존 3개 + 신규 3개 규칙으로 가짜 후기를 종합 분석한다."""
    flags = detect_fake_reviews(reviews)  # 기존 3개 규칙

    # 신규 규칙
    for check_fn in [
        _check_low_credibility_reviewers,
        _check_three_char_nickname_cluster,
        _check_no_photo_five_star_ratio,
        _check_perfect_avg_score_reviewers,
        _check_perfect_score_date_cluster,
        _check_fake_review_mention,
    ]:
        flag = check_fn(reviews)
        if flag:
            flags.append(flag)

    # 의심 점수 계산 (0~100)
    suspicion_score = 0.0
    for flag in flags:
        for keyword, weight in _SUSPICION_WEIGHTS.items():
            if keyword in flag.reason:
                suspicion_score += weight
                break
    suspicion_score = min(100.0, suspicion_score)

    return FakeReviewResult(flags=flags, suspicion_score=suspicion_score)
