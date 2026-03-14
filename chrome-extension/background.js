// --- API URLs ---
const SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const CATEGORY_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/category.json";
const PANEL3_URL = "https://place-api.map.kakao.com/places/panel3/";
const REVIEWS_URL =
  "https://place-api.map.kakao.com/places/tab/reviews/kakaomap/";

const PLACE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  pf: "PC",
  appversion: "6.6.0",
};

// --- 캐시 (24시간 TTL) ---

const CACHE_TTL = 24 * 60 * 60 * 1000;

function cacheGet(key) {
  return new Promise((resolve) => {
    const k = "c:" + key;
    chrome.storage.local.get(k, (data) => {
      const entry = data[k];
      if (!entry || Date.now() - entry.t > CACHE_TTL) {
        resolve(null);
      } else {
        resolve(entry.d);
      }
    });
  });
}

function cacheSet(key, data) {
  const k = "c:" + key;
  chrome.storage.local.set({ [k]: { d: data, t: Date.now() } });
}

function cacheClearAll() {
  chrome.storage.local.get(null, (all) => {
    const keys = Object.keys(all).filter((k) => k.startsWith("c:"));
    if (keys.length > 0) chrome.storage.local.remove(keys);
  });
}

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

// --- 장소 검색 (카테고리 제한 없음) ---

async function searchPlacesOpen(query, apiKey, maxPages = 3) {
  const places = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      query,
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
        categoryGroupCode: d.category_group_code || "",
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

// --- 장소 이름 → 좌표 검색 (disambiguation) ---

async function resolvePlace(query, apiKey) {
  const params = new URLSearchParams({
    query,
    size: "3",
    page: "1",
  });
  const resp = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return (data.documents || []).map((d) => ({
    id: d.id,
    name: d.place_name,
    category: d.category_name || "",
    address: d.address_name || "",
    x: parseFloat(d.x),
    y: parseFloat(d.y),
  }));
}

// --- 좌표 기반 주변 음식점 검색 ---

async function searchNearbyPlacesSingle(cx, cy, apiKey, radius, maxPages = 3) {
  const places = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      category_group_code: "FD6",
      x: String(cx),
      y: String(cy),
      radius: String(radius),
      sort: "distance",
      size: "15",
      page: String(page),
    });
    const resp = await fetch(`${CATEGORY_SEARCH_URL}?${params}`, {
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
        phone: d.phone || "",
        url: d.place_url || "",
        x: parseFloat(d.x),
        y: parseFloat(d.y),
        distance: parseInt(d.distance) || 0,
      });
    }
    if (data.meta?.is_end) break;
  }
  return places;
}

async function searchNearbyPlaces(x, y, apiKey, radius = 500, maxPages = 3) {
  // 중심 + 4방향 오프셋으로 검색 → 중복 제거 → 더 많은 결과
  // 위도 1도 ≈ 111km, 경도 1도 ≈ 88km (한국 기준)
  const offset = radius * 0.4;
  const dLat = offset / 111000;
  const dLng = offset / 88000;

  const centers = [
    [x, y],                       // 중심
    [x, y + dLat],                // 북
    [x, y - dLat],                // 남
    [x + dLng, y],                // 동
    [x - dLng, y],                // 서
  ];

  const seen = new Map();
  for (const [cx, cy] of centers) {
    const batch = await searchNearbyPlacesSingle(cx, cy, apiKey, radius, maxPages);
    for (const p of batch) {
      if (!seen.has(p.id)) {
        // 원래 중심점 기준 거리 재계산
        p.distance = haversine(y, x, p.y, p.x);
        seen.set(p.id, p);
      }
    }
  }

  return [...seen.values()].sort((a, b) => a.distance - b.distance);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// --- 리뷰 조회 (캐시 적용) ---

async function fetchReviewSummaryCached(placeId) {
  const cached = await cacheGet("r:" + placeId);
  if (cached) return cached;
  const result = await fetchReviewSummary(placeId);
  if (result) cacheSet("r:" + placeId, result);
  return result;
}

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

  // 5) 세글자 한글 닉네임 5점이 전체 리뷰 흐름에서 연속 3개 이상
  const isThreeCharKorean = (n) =>
    n.length === 3 && [...n].every((c) => c >= "\uAC00" && c <= "\uD7A3");
  const allSortedByDate = [...reviews].sort((a, b) => a.date.localeCompare(b.date));
  let maxConsec = 0, consec = 0;
  for (const r of allSortedByDate) {
    if (r.rating >= 5 && isThreeCharKorean(r.nickname)) {
      consec++;
      if (consec > maxConsec) maxConsec = consec;
    } else {
      consec = 0;
    }
  }
  if (maxConsec >= 3) {
    flags.push({ reason: `세글자 닉네임 5점 ${maxConsec}연속` });
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

// --- 주변 맛집 파이프라인 (리뷰 분석 + 즐겨찾기 매칭) ---

async function runNearbyPipeline(x, y, apiKey, favIds, radius = 500, topN = 10, tabId) {
  const places = await searchNearbyPlaces(x, y, apiKey, radius);
  if (places.length === 0) return { results: [], total: 0 };

  const results = [];
  const batchSize = 5;

  for (let i = 0; i < places.length; i += batchSize) {
    const batch = places.slice(i, i + batchSize);
    const summaries = await Promise.all(
      batch.map((p) => fetchReviewSummaryCached(p.id))
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
        isFavorite: favIds.has(place.id),
        distance: place.distance || 0,
      });
    }

    // 진행 상황 브로드캐스트
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "progress",
        done: Math.min(i + batchSize, places.length),
        total: places.length,
      }).catch(() => {});
    }
  }

  // 점수순 정렬
  results.sort((a, b) => b.score - a.score);

  return { results: results.slice(0, topN), total: places.length, mode: "nearby" };
}

// --- 지역 추출 (주소 → "시/도 구/군") ---

function extractRegion(address) {
  if (!address) return "기타";
  const parts = address.split(" ");
  // "서울 강남구 ..." → "서울 강남구"
  // "경기 용인시 수지구 ..." → "경기 용인시 수지구"
  if (parts.length >= 3 && parts[1].endsWith("시") && parts[2].endsWith("구")) {
    return parts.slice(0, 3).join(" ");
  }
  if (parts.length >= 2) {
    return parts.slice(0, 2).join(" ");
  }
  return parts[0] || "기타";
}

// --- 통합 파이프라인 (키워드 검색 → 결과 없으면 주변 검색 자동 전환) ---

async function runUnifiedPipeline(query, apiKey, favIds, topN = 10, tabId) {
  // 캐시 확인
  const cacheKey = "q:" + query + ":" + topN;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    // 즐겨찾기 매칭만 갱신 (favorites는 변경될 수 있으므로)
    for (const r of cached.results) {
      r.isFavorite = favIds.has(r.place.id);
    }
    cached.fromCache = true;
    return cached;
  }

  // 1) FD6 키워드 검색 먼저
  const fd6Places = await searchPlaces(query, apiKey);

  // 2) FD6 결과가 부족하면 (< 5개) → 오픈 검색 → 비음식점 anchor로 nearby
  if (fd6Places.length < 5) {
    const allPlaces = await searchPlacesOpen(query, apiKey, 1);
    const anchor = allPlaces.find((p) => p.categoryGroupCode !== "FD6");

    if (anchor) {
      // 비음식점 anchor 발견 → nearby 모드
      const anchors = allPlaces
        .filter((p) => p.categoryGroupCode !== "FD6")
        .slice(0, 3);

      // 여러 지역에 걸치면 disambiguation
      if (anchors.length >= 2) {
        const regions = anchors.map((p) => extractRegion(p.address));
        const uniqueRegions = new Set(regions);
        if (uniqueRegions.size >= 2) {
          return { mode: "disambiguate", places: anchors };
        }
      }

      const nearbyResult = await runNearbyPipeline(
        anchor.x, anchor.y, apiKey, favIds, 500, topN, tabId
      );
      nearbyResult.mode = "nearby";
      nearbyResult.anchor = anchor;
      cacheSet(cacheKey, nearbyResult);
      return nearbyResult;
    }

    // 비음식점 anchor 못 찾았어도 FD6 < 5이면 첫 결과로 nearby
    const fallback = allPlaces[0] || fd6Places[0];
    if (!fallback) return { results: [], total: 0, mode: "empty" };

    const nearbyResult = await runNearbyPipeline(
      fallback.x, fallback.y, apiKey, favIds, 500, topN, tabId
    );
    nearbyResult.mode = "nearby";
    nearbyResult.anchor = fallback;
    cacheSet(cacheKey, nearbyResult);
    return nearbyResult;
  }

  const places = fd6Places;

  // 2.5) 음식점 결과가 여러 지역에 걸치면 disambiguation
  const placeRegions = places.map((p) => extractRegion(p.address));
  const uniquePlaceRegions = new Set(placeRegions);
  if (uniquePlaceRegions.size >= 2) {
    const regionMap = {};
    for (let i = 0; i < places.length; i++) {
      const region = placeRegions[i];
      if (!regionMap[region]) {
        regionMap[region] = places[i];
      }
    }
    const representatives = Object.values(regionMap);
    return { mode: "disambiguate", places: representatives };
  }

  // 3) 키워드 결과 있음 → 리뷰 분석
  const results = [];
  const batchSize = 5;

  for (let i = 0; i < places.length; i += batchSize) {
    const batch = places.slice(i, i + batchSize);
    const summaries = await Promise.all(
      batch.map((p) => fetchReviewSummaryCached(p.id))
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
        isFavorite: favIds.has(place.id),
        distance: place.distance || null,
      });
    }

    // 진행 상황 브로드캐스트
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "progress",
        done: Math.min(i + batchSize, places.length),
        total: places.length,
      }).catch(() => {});
    }
  }

  // 점수순 정렬
  results.sort((a, b) => b.score - a.score);

  const result = { results: results.slice(0, topN), total: places.length, mode: "keyword" };
  cacheSet(cacheKey, result);
  return result;
}

// --- 메시지 핸들러 ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "search") {
    chrome.storage.local.get("apiKey", ({ apiKey }) => {
      if (!apiKey) {
        sendResponse({ error: "API 키를 먼저 설정해주세요" });
        return;
      }
      searchPlacesOpen(msg.query, apiKey, 1)
        .then((places) => sendResponse({ mode: "select", places }))
        .catch((err) => sendResponse({ error: err.message }));
    });
    return true;
  }

  if (msg.type === "resolvePlace") {
    chrome.storage.local.get("apiKey", ({ apiKey }) => {
      if (!apiKey) {
        sendResponse({ error: "API 키를 먼저 설정해주세요" });
        return;
      }
      resolvePlace(msg.query, apiKey)
        .then((places) => sendResponse({ places }))
        .catch((err) => sendResponse({ error: err.message }));
    });
    return true;
  }

  if (msg.type === "nearbySearch") {
    chrome.storage.local.get(["apiKey", "favorites"], ({ apiKey, favorites }) => {
      if (!apiKey) {
        sendResponse({ error: "API 키를 먼저 설정해주세요" });
        return;
      }
      const favs = favorites || [];
      const favIds = new Set(favs.map((f) => f.id));
      const radius = msg.radius || 500;
      runNearbyPipeline(msg.x, msg.y, apiKey, favIds, radius, msg.topN || 20, sender.tab?.id)
        .then((result) => {
          // 500m 내 즐겨찾기 (맛집 결과에 없는 것만)
          const resultIds = new Set(result.results.map((r) => r.place.id));
          result.nearbyFavorites = favs
            .filter((f) => f.x && f.y && !resultIds.has(f.id))
            .map((f) => ({ ...f, distance: haversine(msg.y, msg.x, f.y, f.x) }))
            .filter((f) => f.distance <= radius)
            .sort((a, b) => a.distance - b.distance);
          sendResponse(result);
        })
        .catch((err) => sendResponse({ error: err.message }));
    });
    return true;
  }

  if (msg.type === "searchFavorites") {
    chrome.storage.local.get("favorites", ({ favorites }) => {
      if (!favorites || favorites.length === 0) {
        sendResponse({ error: "즐겨찾기를 먼저 가져와주세요 (확장 아이콘 클릭 → 파일 선택)" });
        return;
      }
      const keyword = (msg.query || "").toLowerCase();
      // 한글 → 영문 지역명 매핑 (영문 주소 검색용)
      const koEnMap = {
        "강남": "gangnam", "서초": "seocho", "송파": "songpa", "마포": "mapo",
        "종로": "jongno", "용산": "yongsan", "성동": "seongdong", "광진": "gwangjin",
        "동대문": "dongdaemun", "중랑": "jungnang", "성북": "seongbuk", "강북": "gangbuk",
        "도봉": "dobong", "노원": "nowon", "은평": "eunpyeong", "서대문": "seodaemun",
        "중구": "jung-gu", "동작": "dongjak", "관악": "gwanak", "금천": "geumcheon",
        "영등포": "yeongdeungpo", "구로": "guro", "양천": "yangcheon", "강서": "gangseo",
        "강동": "gangdong", "서울": "seoul", "부산": "busan", "인천": "incheon",
        "대구": "daegu", "대전": "daejeon", "광주": "gwangju", "수원": "suwon",
        "용인": "yongin", "성남": "seongnam", "제주": "jeju",
      };
      const extraKeywords = [];
      for (const [ko, en] of Object.entries(koEnMap)) {
        if (keyword.includes(ko)) extraKeywords.push(en);
      }
      const matched = favorites.filter((f) => {
        const fields = [f.name, f.address, f.memo, f.group_name].map(
          (v) => (v || "").toLowerCase()
        );
        return (
          fields.some((v) => v.includes(keyword)) ||
          extraKeywords.some((en) => fields.some((v) => v.includes(en)))
        );
      });
      sendResponse({ results: matched, total: matched.length });
    });
    return true;
  }

  if (msg.type === "clearCache") {
    cacheClearAll();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "analyzePlace") {
    fetchReviewSummaryCached(msg.placeId)
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
