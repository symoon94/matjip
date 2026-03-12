// --- API URLs ---
const SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const PANEL3_URL = "https://place-api.map.kakao.com/places/panel3/";
const REVIEWS_URL =
  "https://place-api.map.kakao.com/places/tab/reviews/kakaomap/";

const PLACE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  pf: "PC",
  appversion: "6.6.0",
};

// --- 장소 검색 ---

async function searchPlaces(query, apiKey, maxPages = 3) {
  const places = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      query,
      category_group_code: "FD6",
      size: "15",
      page: String(page),
    });
    const resp = await fetch(`${SEARCH_URL}?${params}`, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
    });
    if (!resp.ok) break;
    const data = await resp.json();
    for (const d of data.documents || []) {
      places.push({
        id: d.id,
        name: d.place_name,
        category: d.category_name || "",
        address: d.address_name || "",
        roadAddress: d.road_address_name || "",
        phone: d.phone || "",
        url: d.place_url || "",
        x: parseFloat(d.x),
        y: parseFloat(d.y),
      });
    }
    if (data.meta?.is_end) break;
  }
  return places;
}

// --- 리뷰 조회 ---

async function fetchReviewSummary(placeId) {
  try {
    const resp = await fetch(PANEL3_URL + placeId, { headers: PLACE_HEADERS });
    if (!resp.ok) return null;

    const data = await resp.json();
    const scoreSet = (data.kakaomap_review || {}).score_set || {};
    const avgRating = parseFloat(scoreSet.average_score || 0);
    const reviewCount = parseInt(scoreSet.review_count || 0);

    const resp2 = await fetch(`${REVIEWS_URL}${placeId}`, {
      headers: PLACE_HEADERS,
    });

    const reviews = [];
    if (resp2.ok) {
      const reviewData = await resp2.json();
      for (const item of reviewData.reviews || []) {
        const owner = (item.meta || {}).owner || {};
        reviews.push({
          nickname: owner.nickname || "",
          rating: parseFloat(item.star_rating || 0),
          text: item.contents || "",
          date: (item.registered_at || "").slice(0, 10),
          photoCount: parseInt(item.photo_count || 0),
          reviewerReviewCount: owner.review_count ?? null,
          reviewerFollowerCount: owner.follower_count ?? null,
          reviewerAvgScore: owner.average_score ?? null,
        });
      }
    }

    return { placeId, avgRating, reviewCount, reviews };
  } catch {
    return null;
  }
}

// --- 가짜 후기 분석 ---

function analyzeFakeReviews(reviews) {
  const flags = [];
  const fiveStar = reviews.filter((r) => r.rating >= 5);

  // 1) 같은 날짜 5점 집중
  const byDate = {};
  for (const r of fiveStar) (byDate[r.date] = byDate[r.date] || []).push(r);
  for (const [dt, revs] of Object.entries(byDate)) {
    if (revs.length >= 3) {
      flags.push({ reason: `같은 날짜 5점 집중 (${dt})` });
      break;
    }
  }

  // 2) 유사 닉네임
  if (fiveStar.length >= 3) {
    const patterns = {};
    for (const r of fiveStar) {
      const key =
        r.nickname.replace(/[0-9_\-.]+/g, "").trim().toLowerCase() ||
        r.nickname.toLowerCase();
      (patterns[key] = patterns[key] || []).push(r);
    }
    for (const group of Object.values(patterns)) {
      if (group.length >= 3) {
        flags.push({ reason: "유사 닉네임 5점 다수" });
        break;
      }
    }
  }

  // 3) 7일 내 burst
  const sorted = [...fiveStar].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length >= 5) {
    for (let i = 0; i <= sorted.length - 5; i++) {
      const days =
        (new Date(sorted[i + 4].date) - new Date(sorted[i].date)) / 86400000;
      if (days <= 7) {
        flags.push({ reason: "7일 내 5점 burst" });
        break;
      }
    }
  }

  // 4) 저신뢰 계정
  const lowCred = fiveStar.filter(
    (r) =>
      r.reviewerReviewCount !== null &&
      r.reviewerReviewCount <= 2 &&
      r.reviewerFollowerCount === 0 &&
      r.reviewerAvgScore !== null &&
      r.reviewerAvgScore >= 4.8
  );
  if (lowCred.length >= 3) {
    flags.push({ reason: `저신뢰 계정 ${lowCred.length}개` });
  }

  // 5) 세글자 한글 닉네임
  const threeChar = fiveStar.filter((r) => {
    const n = r.nickname;
    return (
      n.length === 3 && [...n].every((c) => c >= "\uAC00" && c <= "\uD7A3")
    );
  });
  if (threeChar.length >= 4) {
    flags.push({ reason: "세글자 닉네임 집중" });
  }

  // 6) 사진 없는 5점 비율
  if (fiveStar.length >= 5) {
    const noPhoto = fiveStar.filter((r) => r.photoCount === 0);
    const ratio = (noPhoto.length / fiveStar.length) * 100;
    if (ratio >= 70) {
      flags.push({ reason: `무사진 5점 ${Math.round(ratio)}%` });
    }
  }

  // 7) 별점평균 5.0 리뷰어 집중
  const perfectAvg = fiveStar.filter(
    (r) => r.reviewerAvgScore !== null && r.reviewerAvgScore >= 5.0
  );
  if (perfectAvg.length >= 3) {
    flags.push({
      reason: `별점평균 5.0 리뷰어 ${perfectAvg.length}명이 5점 리뷰`,
    });
  }

  // 8) 평균5.0 리뷰어 5점 날짜 집중 (1~2일 내 2명 이상 → 조작 확정)
  const perfSorted = [...perfectAvg].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  if (perfSorted.length >= 2) {
    const clusterDates = [];
    for (let i = 0; i <= perfSorted.length - 2; i++) {
      const days =
        (new Date(perfSorted[i + 1].date) - new Date(perfSorted[i].date)) /
        86400000;
      if (days <= 2) {
        clusterDates.push(perfSorted[i].date);
      }
    }
    if (clusterDates.length > 0) {
      const unique = [...new Set(clusterDates)].sort();
      flags.push({
        reason: `평균5.0 리뷰어 5점 날짜 집중 (${unique.join(", ")})`,
      });
    }
  }

  // 9) 후기 알바 언급 탐지
  const fakeKeywords = [
    "후기 알바", "후기알바", "리뷰 알바", "리뷰알바",
    "광고 리뷰", "광고리뷰", "돈 받고", "돈받고",
    "협찬 리뷰", "협찬리뷰", "알바 리뷰", "알바리뷰",
    "가짜 리뷰", "가짜리뷰", "조작 리뷰", "조작리뷰",
    "별점 조작", "별점조작", "리뷰 조작", "리뷰조작",
  ];
  const mentionCount = reviews.filter((r) =>
    fakeKeywords.some((kw) => r.text.includes(kw))
  ).length;
  if (mentionCount > 0) {
    flags.push({ reason: `후기 알바 언급 리뷰 ${mentionCount}건` });
  }

  // 의심 점수
  const weights = {
    "날짜 집중": 35,
    "후기 알바 언급": 30,
    "같은 날짜": 25,
    "별점평균 5.0 리뷰어": 20,
    닉네임: 20,
    "일 내": 20,
    저신뢰: 15,
    세글자: 10,
    사진: 10,
  };
  let score = 0;
  for (const f of flags) {
    for (const [kw, w] of Object.entries(weights)) {
      if (f.reason.includes(kw)) {
        score += w;
        break;
      }
    }
  }
  return { flags, suspicionScore: Math.min(100, score) };
}

// --- 스코어링 ---

const W_RATING = 30,
  W_COUNT = 20,
  W_FAKE = -20;

function scorePlace(summary, analysis) {
  const rating = Math.max(0, (summary.avgRating - 4.0) * W_RATING);
  const count = Math.min(W_COUNT, Math.log1p(summary.reviewCount) * 4);
  const fake = analysis.flags.length * W_FAKE;
  const reviewFilter =
    summary.reviewCount >= 10 && summary.avgRating >= 4.0 ? 0 : -50;
  const total = rating + count + fake + reviewFilter;

  return {
    score: Math.round(total * 10) / 10,
    breakdown: { rating, count, fake, reviewFilter },
  };
}

// --- 전체 파이프라인 ---

async function runPipeline(query, apiKey, topN = 10) {
  // 1) 검색
  const places = await searchPlaces(query, apiKey);
  if (places.length === 0) return { results: [], total: 0 };

  // 2) 리뷰 분석 (동시 5개씩)
  const results = [];
  const batchSize = 5;

  for (let i = 0; i < places.length; i += batchSize) {
    const batch = places.slice(i, i + batchSize);
    const summaries = await Promise.all(
      batch.map((p) => fetchReviewSummary(p.id))
    );

    for (let j = 0; j < batch.length; j++) {
      const place = batch[j];
      const summary = summaries[j];
      if (!summary) continue;

      const analysis = analyzeFakeReviews(summary.reviews);
      const { score, breakdown } = scorePlace(summary, analysis);

      results.push({
        place,
        avgRating: summary.avgRating,
        reviewCount: summary.reviewCount,
        reviewsFetched: summary.reviews.length,
        suspicionScore: analysis.suspicionScore,
        flags: analysis.flags,
        score,
        breakdown,
      });
    }

    // 진행 상황 브로드캐스트
    const tabs = await chrome.tabs.query({
      url: ["https://map.kakao.com/*"],
    });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: "progress",
        done: Math.min(i + batchSize, places.length),
        total: places.length,
      });
    }
  }

  // 3) 정렬
  results.sort((a, b) => b.score - a.score);

  return { results: results.slice(0, topN), total: places.length };
}

// --- 메시지 핸들러 ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "search") {
    chrome.storage.local.get("apiKey", ({ apiKey }) => {
      if (!apiKey) {
        sendResponse({ error: "API 키를 먼저 설정해주세요" });
        return;
      }
      runPipeline(msg.query, apiKey, msg.topN || 10)
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
    });
    return true;
  }

  if (msg.type === "analyzePlace") {
    fetchReviewSummary(msg.placeId)
      .then((summary) => {
        if (!summary) {
          sendResponse({ error: "리뷰 데이터를 가져올 수 없습니다" });
          return;
        }
        const analysis = analyzeFakeReviews(summary.reviews);
        sendResponse({
          placeId: summary.placeId,
          avgRating: summary.avgRating,
          reviewCount: summary.reviewCount,
          suspicionScore: analysis.suspicionScore,
          flags: analysis.flags,
          reviewsFetched: summary.reviews.length,
        });
      })
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});
