// map.kakao.com에 맛집 검색 패널을 플로팅으로 표시

(function () {
  // place.map.kakao.com → 개별 식당 분석 (기존)
  if (location.hostname === "place.map.kakao.com") {
    const match = location.pathname.match(/^\/(\d+)/);
    if (!match) return;
    chrome.runtime.sendMessage(
      { type: "analyzePlace", placeId: match[1] },
      (r) => {
        if (r && !r.error) injectPlaceBadge(r);
      }
    );
    return;
  }

  // map.kakao.com → 검색 패널
  createPanel();

  function createPanel() {
    const panel = document.createElement("div");
    panel.id = "matjip-panel";
    panel.innerHTML = `
      <div id="matjip-titlebar">
        <span>\u{1F37D}\uFE0F 맛집 어시스턴트</span>
        <button id="matjip-minimize" title="접기">\u2013</button>
      </div>
      <div id="matjip-content">
        <div id="matjip-search-box">
          <input id="matjip-query" type="text" placeholder="강남 한식, 홍대 이탈리안..." />
          <button id="matjip-search-btn">검색</button>
        </div>
        <div id="matjip-status"></div>
        <div id="matjip-results"></div>
      </div>
    `;
    document.body.appendChild(panel);

    // 드래그
    makeDraggable(panel, panel.querySelector("#matjip-titlebar"));

    // 접기/펼치기
    const content = panel.querySelector("#matjip-content");
    const minBtn = panel.querySelector("#matjip-minimize");
    minBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const hidden = content.style.display === "none";
      content.style.display = hidden ? "block" : "none";
      minBtn.textContent = hidden ? "\u2013" : "\u002B";
    });

    // 검색
    const input = panel.querySelector("#matjip-query");
    const btn = panel.querySelector("#matjip-search-btn");

    btn.addEventListener("click", () => doSearch(input.value.trim()));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch(input.value.trim());
    });
  }

  function doSearch(query) {
    if (!query) return;

    const status = document.getElementById("matjip-status");
    const results = document.getElementById("matjip-results");
    const btn = document.getElementById("matjip-search-btn");

    status.textContent = "검색 중...";
    status.className = "matjip-loading";
    results.innerHTML = "";
    btn.disabled = true;

    chrome.runtime.sendMessage(
      { type: "search", query, topN: 10 },
      (resp) => {
        btn.disabled = false;

        if (chrome.runtime.lastError || !resp) {
          status.textContent = "오류가 발생했습니다";
          status.className = "matjip-error";
          return;
        }

        if (resp.error) {
          if (resp.error.includes("API 키")) {
            status.innerHTML =
              '확장 아이콘 클릭 → API 키 설정 필요';
          } else {
            status.textContent = resp.error;
          }
          status.className = "matjip-error";
          return;
        }

        status.textContent = `${resp.total}개 장소 중 상위 ${resp.results.length}개`;
        status.className = "";
        renderResults(resp.results);
      }
    );
  }

  function renderResults(items) {
    const container = document.getElementById("matjip-results");
    container.innerHTML = "";

    for (let i = 0; i < items.length; i++) {
      const r = items[i];
      const row = document.createElement("div");
      row.className = "matjip-row";

      // 의심도 색상
      let suspColor = "#27ae60";
      if (r.suspicionScore >= 50) suspColor = "#e74c3c";
      else if (r.suspicionScore > 0) suspColor = "#e67e22";

      // 카테고리 정리
      const cat = r.place.category.includes(" > ")
        ? r.place.category.split(" > ").pop()
        : r.place.category;

      row.innerHTML = `
        <div class="matjip-row-header">
          <span class="matjip-rank">${i + 1}</span>
          <span class="matjip-name">${esc(r.place.name)}</span>
          <span class="matjip-score">${r.score.toFixed(1)}</span>
        </div>
        <div class="matjip-row-details">
          <span class="matjip-cat">${esc(cat)}</span>
          <span class="matjip-rating">\u2B50 ${r.avgRating.toFixed(1)}</span>
          <span class="matjip-reviews">\u{1F4AC} ${r.reviewCount}</span>
          <span class="matjip-susp" style="color:${suspColor}">
            의심 ${r.suspicionScore}%
          </span>
        </div>
        ${
          r.flags.length > 0
            ? `<div class="matjip-row-flags">${r.flags.map((f) => `<span class="matjip-flag-tag">${esc(f.reason)}</span>`).join("")}</div>`
            : ""
        }
      `;

      // 클릭 → 지도 이동 + 카카오맵 검색 패널 연동
      row.addEventListener("click", () => {
        window.postMessage(
          { source: "matjip", action: "panTo", lat: r.place.y, lng: r.place.x },
          "*"
        );
        triggerKakaoSearch(r.place.name);
        // 선택 강조
        document
          .querySelectorAll(".matjip-row.selected")
          .forEach((el) => el.classList.remove("selected"));
        row.classList.add("selected");
      });

      row.title = r.place.address;
      container.appendChild(row);
    }

    // 지도에 마커 표시 (via map-bridge)
    const markerItems = items.map((r, i) => ({
      rank: i + 1,
      lat: r.place.y,
      lng: r.place.x,
      name: r.place.name,
      suspicion: r.suspicionScore,
    }));
    window.postMessage(
      { source: "matjip", action: "setMarkers", items: markerItems },
      "*"
    );
  }

  // 진행 상황 수신
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "progress") {
      const status = document.getElementById("matjip-status");
      if (status) {
        status.textContent = `리뷰 분석 중... (${msg.done}/${msg.total})`;
        status.className = "matjip-loading";
      }
    }
  });

  // --- 카카오맵 왼쪽 패널 검색 연동 ---

  function triggerKakaoSearch(query) {
    // 카카오맵 검색 입력창 찾기
    const input =
      document.querySelector("#search\\.keyword\\.query") ||
      document.querySelector(".box_searchbar input[type='text']") ||
      document.querySelector("input[placeholder*='검색']") ||
      document.querySelector("input.query");
    if (!input) return;

    // React/framework 호환: native setter로 값 설정
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // 검색 버튼 클릭
    const btn =
      document.querySelector("#search\\.keyword .btn_search") ||
      document.querySelector(".btn_search") ||
      input.closest("form")?.querySelector("button");
    if (btn) {
      btn.click();
    } else {
      // 폼 submit 또는 Enter 키
      const form = input.closest("form");
      if (form) {
        form.dispatchEvent(new Event("submit", { bubbles: true }));
      } else {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            bubbles: true,
          })
        );
      }
    }
  }

  // --- 유틸 ---

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function makeDraggable(el, handle) {
    let dragging = false,
      startX,
      startY,
      origX,
      origY;

    handle.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      el.style.left = origX + (e.clientX - startX) + "px";
      el.style.top = origY + (e.clientY - startY) + "px";
      el.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  // --- place.map.kakao.com 배지 ---

  function injectPlaceBadge(result) {
    const score = result.suspicionScore;
    let cls, emoji;
    if (score >= 50) { cls = "matjip-danger"; emoji = "\u{1F6A8}"; }
    else if (score > 0) { cls = "matjip-warning"; emoji = "\u26A0\uFE0F"; }
    else { cls = "matjip-safe"; emoji = "\u2705"; }

    const badge = document.createElement("div");
    badge.id = "matjip-badge";
    badge.className = cls;
    badge.innerHTML = `
      <div class="matjip-header">${emoji} 의심도 ${score}%</div>
      <div class="matjip-body">
        <div class="matjip-info">평점 ${result.avgRating.toFixed(1)} · 리뷰 ${result.reviewCount}개 (${result.reviewsFetched}개 분석)</div>
        ${
          result.flags.length > 0
            ? result.flags.map((f) => `<div class="matjip-flag">\u00B7 ${f.reason}</div>`).join("")
            : '<div class="matjip-ok">의심 패턴 없음</div>'
        }
      </div>
    `;
    document.body.appendChild(badge);
  }
})();
