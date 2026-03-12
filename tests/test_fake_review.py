from datetime import date, timedelta

from restaurant_assistant.fake_review import analyze_fake_reviews, detect_fake_reviews
from restaurant_assistant.models import Review


def _make_review(
    nickname: str = "user",
    rating: float = 5.0,
    review_date: date | None = None,
    text: str = "맛있어요",
    photo_count: int = 0,
    reviewer_review_count: int | None = None,
    reviewer_follower_count: int | None = None,
    reviewer_avg_score: float | None = None,
) -> Review:
    return Review(
        nickname=nickname,
        rating=rating,
        text=text,
        date=review_date or date.today(),
        photo_count=photo_count,
        reviewer_review_count=reviewer_review_count,
        reviewer_follower_count=reviewer_follower_count,
        reviewer_avg_score=reviewer_avg_score,
    )


def test_same_date_cluster_detected():
    today = date.today()
    reviews = [
        _make_review(nickname=f"user{i}", review_date=today) for i in range(5)
    ]
    flags = detect_fake_reviews(reviews)
    assert any("같은 날짜" in f.reason for f in flags)


def test_same_date_below_threshold():
    today = date.today()
    reviews = [
        _make_review(nickname=f"user{i}", review_date=today) for i in range(2)
    ]
    flags = detect_fake_reviews(reviews)
    assert not any("같은 날짜" in f.reason for f in flags)


def test_similar_nicknames_detected():
    today = date.today()
    reviews = [
        _make_review(nickname="맛집탐방1", review_date=today - timedelta(days=i))
        for i in range(5)
    ]
    flags = detect_fake_reviews(reviews)
    assert any("닉네임" in f.reason for f in flags)


def test_short_period_burst_detected():
    base = date.today()
    reviews = [
        _make_review(nickname=f"different_user_{i}", review_date=base - timedelta(days=i))
        for i in range(6)
    ]
    flags = detect_fake_reviews(reviews)
    assert any("집중" in f.reason for f in flags)


def test_no_flags_for_normal_reviews():
    base = date.today()
    reviews = [
        _make_review(
            nickname=f"unique_name_{i}",
            rating=4.0,
            review_date=base - timedelta(days=i * 30),
        )
        for i in range(5)
    ]
    flags = detect_fake_reviews(reviews)
    assert len(flags) == 0


def test_low_credibility_reviewers_detected():
    base = date.today()
    reviews = [
        _make_review(
            nickname=f"newbie_{i}",
            rating=5.0,
            review_date=base - timedelta(days=i * 10),
            reviewer_review_count=1,
            reviewer_follower_count=0,
            reviewer_avg_score=5.0,
        )
        for i in range(4)
    ]
    result = analyze_fake_reviews(reviews)
    assert any("저신뢰" in f.reason for f in result.flags)


def test_three_char_nickname_cluster_detected():
    base = date.today()
    nicknames = ["김민수", "이철수", "박영수", "최지수"]
    reviews = [
        _make_review(
            nickname=nick,
            rating=5.0,
            review_date=base - timedelta(days=i * 10),
        )
        for i, nick in enumerate(nicknames)
    ]
    result = analyze_fake_reviews(reviews)
    assert any("세글자" in f.reason for f in result.flags)


def test_no_photo_five_star_ratio_detected():
    base = date.today()
    reviews = [
        _make_review(
            nickname=f"photo_user_{i}",
            rating=5.0,
            review_date=base - timedelta(days=i * 10),
            photo_count=0,
        )
        for i in range(6)
    ]
    # 2개는 사진 있음
    reviews.extend([
        _make_review(
            nickname=f"real_user_{i}",
            rating=5.0,
            review_date=base - timedelta(days=i * 10 + 5),
            photo_count=3,
        )
        for i in range(2)
    ])
    result = analyze_fake_reviews(reviews)
    assert any("사진" in f.reason for f in result.flags)


def test_perfect_avg_score_reviewers_detected():
    base = date.today()
    reviews = [
        _make_review(
            nickname=f"perfect_{i}",
            rating=5.0,
            review_date=base - timedelta(days=i * 10),
            reviewer_avg_score=5.0,
        )
        for i in range(4)
    ]
    result = analyze_fake_reviews(reviews)
    assert any("별점평균 5.0" in f.reason for f in result.flags)


def test_perfect_score_date_cluster_detected():
    """평균5.0 리뷰어가 1~2일 내 몰리면 조작 확정."""
    reviews = [
        # 2025-07-25에 평균5.0 리뷰어 2명 몰림
        _make_review(nickname="김민성", rating=5.0, review_date=date(2025, 7, 25),
                     reviewer_review_count=3, reviewer_follower_count=0, reviewer_avg_score=5.0),
        _make_review(nickname="창수", rating=5.0, review_date=date(2025, 7, 25),
                     reviewer_review_count=1, reviewer_follower_count=0, reviewer_avg_score=5.0),
        # 다른 날에 진짜 리뷰
        _make_review(nickname="맛집전문가", rating=4.0, review_date=date(2025, 6, 1),
                     reviewer_review_count=200, reviewer_follower_count=50, reviewer_avg_score=4.2),
        _make_review(nickname="솔직리뷰", rating=3.0, review_date=date(2025, 5, 10),
                     reviewer_review_count=80, reviewer_follower_count=10, reviewer_avg_score=3.8),
    ]
    result = analyze_fake_reviews(reviews)
    assert any("날짜 집중" in f.reason for f in result.flags)
    assert result.suspicion_score >= 35


def test_perfect_score_date_cluster_spread_ok():
    """평균5.0이라도 날짜가 분산되면 이 규칙은 안 걸림."""
    reviews = [
        _make_review(nickname="user1", rating=5.0, review_date=date(2025, 1, 1),
                     reviewer_avg_score=5.0),
        _make_review(nickname="user2", rating=5.0, review_date=date(2025, 4, 1),
                     reviewer_avg_score=5.0),
        _make_review(nickname="user3", rating=5.0, review_date=date(2025, 7, 1),
                     reviewer_avg_score=5.0),
    ]
    result = analyze_fake_reviews(reviews)
    assert not any("날짜 집중" in f.reason for f in result.flags)


def test_fake_review_mention_detected():
    base = date.today()
    reviews = [
        _make_review(nickname="normal", rating=4.0, review_date=base, text="맛있어요"),
        _make_review(
            nickname="honest",
            rating=2.0,
            review_date=base - timedelta(days=1),
            text="여기 후기 알바 쓴거 같아요 별점이 너무 이상해",
        ),
        _make_review(nickname="user3", rating=5.0, review_date=base, text="최고!"),
    ]
    result = analyze_fake_reviews(reviews)
    assert any("후기 알바 언급" in f.reason for f in result.flags)
    assert result.suspicion_score >= 30


def test_analyze_fake_reviews_suspicion_score():
    today = date.today()
    # 같은 날짜에 5점 리뷰 집중 (같은 날짜 규칙 트리거)
    # + 짧은 기간 집중 (burst 규칙 트리거)
    # + 저신뢰 계정 (저신뢰 규칙 트리거)
    reviews = [
        _make_review(
            nickname=f"newbie_{i}",
            rating=5.0,
            review_date=today,
            reviewer_review_count=1,
            reviewer_follower_count=0,
            reviewer_avg_score=5.0,
        )
        for i in range(5)
    ]
    result = analyze_fake_reviews(reviews)
    # 같은 날짜(25) + 집중(20) + 저신뢰(15) = 60 이상
    assert result.suspicion_score >= 60
