from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class Place:
    id: str
    name: str
    category: str
    address: str
    road_address: str
    phone: str
    url: str
    x: float
    y: float
    distance: int | None = None


@dataclass
class Review:
    nickname: str
    rating: float
    text: str
    date: date
    visit_count: int | None = None
    photo_count: int = 0
    reviewer_review_count: int | None = None
    reviewer_follower_count: int | None = None
    reviewer_avg_score: float | None = None


@dataclass
class ReviewSummary:
    place_id: str
    avg_rating: float
    review_count: int
    reviews: list[Review] = field(default_factory=list)
    open_hours: str = ""


@dataclass
class FakeReviewFlag:
    reason: str
    suspicious_reviews: list[Review] = field(default_factory=list)


@dataclass
class FakeReviewResult:
    flags: list[FakeReviewFlag] = field(default_factory=list)
    suspicion_score: float = 0.0


@dataclass
class ScoreBreakdown:
    favorite: float = 0.0
    rating: float = 0.0
    review_count: float = 0.0
    fake_penalty: float = 0.0
    review_filter_penalty: float = 0.0

    def format(self) -> str:
        """점수 근거를 한줄 요약으로 반환한다. 예: '즐찾+100 | 평점+15.0 | 리뷰+18.2'"""
        parts = []
        if self.favorite: parts.append(f"즐찾+{self.favorite:.0f}")
        if self.rating: parts.append(f"평점+{self.rating:.1f}")
        if self.review_count: parts.append(f"리뷰+{self.review_count:.1f}")
        if self.fake_penalty: parts.append(f"가짜{self.fake_penalty:.0f}")
        if self.review_filter_penalty: parts.append(f"필터{self.review_filter_penalty:.0f}")
        total = self.favorite + self.rating + self.review_count + self.fake_penalty + self.review_filter_penalty
        return " | ".join(parts) + f" = {total:.1f}"


@dataclass
class ScoredPlace:
    place: Place
    review_summary: ReviewSummary | None = None
    is_favorite: bool = False
    fake_review_flags: list[FakeReviewFlag] = field(default_factory=list)
    score: float = 0.0
    favorite_groups: list[str] = field(default_factory=list)
    suspicion_score: float = 0.0
    score_breakdown: ScoreBreakdown | None = None
