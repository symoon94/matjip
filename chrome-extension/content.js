// map.kakao.com에 맛집 검색 패널을 플로팅으로 표시

(function () {
  // place.map.kakao.com → 개별 식당 분석 (SPA 내비게이션 대응)
  if (location.hostname === "place.map.kakao.com") {
    let currentPlaceId = null;

    function analyzeCurrent() {
      const m = location.pathname.match(/^\/(\d+)/);
      if (!m || m[1] === currentPlaceId) return;
      currentPlaceId = m[1];

      // 기존 배지 제거
      const old = document.getElementById("matjip-badge");
      if (old) old.remove();

      // 로딩 표시
      const loading = document.createElement("div");
      loading.id = "matjip-badge";
      loading.className = "matjip-loading-badge";
      loading.innerHTML = `<div class="matjip-header" style="background:#3498db">분석 중...</div>`;
      document.body.appendChild(loading);

      chrome.runtime.sendMessage(
        { type: "analyzePlace", placeId: currentPlaceId },
        (r) => {
          const el = document.getElementById("matjip-badge");
          if (el) el.remove();
          if (r && !r.error) injectPlaceBadge(r);
        }
      );
    }

    // 초기 분석
    analyzeCurrent();

    // SPA 내비게이션 감지 (URL 변경 polling)
    setInterval(analyzeCurrent, 1000);
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
          <input id="matjip-query" type="text" placeholder="강남 한식, 마지모우..." />
          <div id="matjip-btn-group">
            <button id="matjip-search-btn">검색</button>
            <button id="matjip-fav-btn">\u2B50</button>
          </div>
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

    const favBtn = panel.querySelector("#matjip-fav-btn");

    btn.addEventListener("click", () => doSearch(input.value.trim()));
    favBtn.addEventListener("click", () => doFavSearch(input.value.trim()));
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

    if (!chrome.runtime?.id) {
      status.textContent = "확장이 업데이트되었습니다. 페이지를 새로고침해주세요.";
      status.className = "matjip-error";
      btn.disabled = false;
      return;
    }

    chrome.runtime.sendMessage(
      { type: "search", query },
      (resp) => {
        btn.disabled = false;

        if (chrome.runtime.lastError || !resp) {
          const msg = chrome.runtime.lastError?.message || "";
          if (msg.includes("invalidated")) {
            status.textContent = "확장이 업데이트되었습니다. 페이지를 새로고침해주세요.";
          } else {
            status.textContent = "오류가 발생했습니다";
          }
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

        if (!resp.places || resp.places.length === 0) {
          status.textContent = "검색 결과가 없습니다";
          status.className = "matjip-error";
          return;
        }

        status.textContent = `${resp.places.length}개 장소. 선택하면 주변 맛집+즐겨찾기를 보여줍니다.`;
        status.className = "";
        showSelection(resp.places);
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

      const distLabel = r.distance ? `<span class="matjip-distance">${r.distance}m</span>` : "";

      row.innerHTML = `
        <div class="matjip-row-header">
          <span class="matjip-rank">${i + 1}</span>
          ${r.isFavorite ? '<span class="matjip-fav-mark">\u2B50</span>' : ""}
          <span class="matjip-name">${esc(r.place.name)}</span>
          ${distLabel}
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
      id: r.place.id,
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

  // --- 장소 선택 UI ---

  function showSelection(places) {
    const container = document.getElementById("matjip-results");
    container.innerHTML = "";

    for (const p of places) {
      const row = document.createElement("div");
      row.className = "matjip-row matjip-disambig-row";

      const cat = p.category
        ? p.category.includes(" > ") ? p.category.split(" > ").pop() : p.category
        : "";

      row.innerHTML = `
        <div class="matjip-row-header">
          <span class="matjip-disambig-icon">\u{1F4CD}</span>
          <span class="matjip-name">${esc(p.name)}</span>
        </div>
        <div class="matjip-row-details">
          ${cat ? `<span class="matjip-cat">${esc(cat)}</span>` : ""}
          <span>${esc(p.address)}</span>
        </div>
      `;

      row.addEventListener("click", () => {
        const status = document.getElementById("matjip-status");
        status.textContent = `\u{1F4CD} ${p.name} 주변 검색 중...`;
        status.className = "matjip-loading";
        container.innerHTML = "";

        chrome.runtime.sendMessage(
          { type: "nearbySearch", x: p.x, y: p.y, radius: 500, topN: 20 },
          (resp) => {
            if (chrome.runtime.lastError || !resp) {
              status.textContent = "오류가 발생했습니다";
              status.className = "matjip-error";
              return;
            }
            if (resp.error) {
              status.textContent = resp.error;
              status.className = "matjip-error";
              return;
            }

            const favCount = (resp.nearbyFavorites || []).length;
            const favText = favCount > 0 ? ` + \u2B50${favCount}` : "";
            status.textContent = `\u{1F4CD} ${p.name} 주변 맛집 ${resp.results.length}개${favText}`;
            status.className = "";

            renderResults(resp.results);

            // 맛집 결과에 없는 주변 즐겨찾기 표시
            if (resp.nearbyFavorites && resp.nearbyFavorites.length > 0) {
              renderNearbyFavSection(resp.nearbyFavorites);
            }

            // 즐겨찾기 마커도 포함
            const allMarkers = resp.results.map((r, i) => ({
              rank: i + 1,
              id: r.place.id,
              lat: r.place.y,
              lng: r.place.x,
              name: r.place.name,
              suspicion: r.suspicionScore,
            }));
            (resp.nearbyFavorites || []).forEach((f, i) => {
              allMarkers.push({
                rank: allMarkers.length + 1,
                favRank: i + 1,
                id: f.id,
                lat: f.y,
                lng: f.x,
                name: f.name,
                suspicion: -1,
              });
            });
            window.postMessage(
              { source: "matjip", action: "setMarkers", items: allMarkers },
              "*"
            );

            // 지도 이동
            window.postMessage(
              { source: "matjip", action: "panTo", lat: p.y, lng: p.x },
              "*"
            );
          }
        );
      });

      container.appendChild(row);
    }
  }

  // --- 주변 즐겨찾기 섹션 ---

  function renderNearbyFavSection(items) {
    const container = document.getElementById("matjip-results");

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 12px;font-size:12px;color:#e67e22;font-weight:700;border-top:2px solid #e67e22;margin-top:4px;";
    header.textContent = `\u2B50 주변 즐겨찾기 (${items.length}개)`;
    container.appendChild(header);

    items.forEach((f, idx) => {
      const row = document.createElement("div");
      row.className = "matjip-row";
      const favRank = idx + 1;

      let addr = f.address || "";
      if (addr.includes("(")) addr = addr.substring(0, addr.indexOf("(")).trim();
      const addrParts = addr.split(" ");
      if (addrParts.length > 1 && addrParts[0].length >= 2) {
        addr = addrParts.slice(1).join(" ");
      }

      row.innerHTML = `
        <div class="matjip-row-header">
          <span class="matjip-rank matjip-rank-fav">${favRank}</span>
          <span class="matjip-fav-mark">\u2B50</span>
          <span class="matjip-name">${esc(f.name)}</span>
          <span class="matjip-distance">${f.distance}m</span>
        </div>
        <div class="matjip-row-details">
          <span>${esc(addr)}</span>
        </div>
        ${f.memo ? `<div class="matjip-row-details"><span class="matjip-memo">${esc(f.memo)}</span></div>` : ""}
      `;

      row.addEventListener("click", () => {
        if (f.x && f.y) {
          window.postMessage(
            { source: "matjip", action: "panTo", lat: f.y, lng: f.x },
            "*"
          );
        }
        triggerKakaoSearch(f.name);
        document.querySelectorAll(".matjip-row.selected").forEach((el) => el.classList.remove("selected"));
        row.classList.add("selected");
      });

      row.title = f.address || "";
      container.appendChild(row);
    });
  }

  // --- 즐겨찾기 검색 ---

  function doFavSearch(query) {
    if (!query) return;

    const status = document.getElementById("matjip-status");
    const results = document.getElementById("matjip-results");
    const favBtn = document.getElementById("matjip-fav-btn");

    status.textContent = "즐겨찾기 검색 중...";
    status.className = "matjip-loading";
    results.innerHTML = "";
    favBtn.disabled = true;

    if (!chrome.runtime?.id) {
      status.textContent = "확장이 업데이트되었습니다. 페이지를 새로고침해주세요.";
      status.className = "matjip-error";
      favBtn.disabled = false;
      return;
    }

    chrome.runtime.sendMessage(
      { type: "searchFavorites", query },
      (resp) => {
        favBtn.disabled = false;

        if (chrome.runtime.lastError || !resp) {
          status.textContent = "오류가 발생했습니다";
          status.className = "matjip-error";
          return;
        }

        if (resp.error) {
          status.textContent = resp.error;
          status.className = "matjip-error";
          return;
        }

        if (resp.results.length === 0) {
          status.textContent = `즐겨찾기에서 '${query}' 검색 결과 없음`;
          status.className = "matjip-error";
          return;
        }

        status.textContent = `\u2B50 즐겨찾기 ${resp.total}개 중 ${resp.results.length}개 표시`;
        status.className = "";
        renderFavResults(resp.results);
      }
    );
  }

  function renderFavResults(items) {
    const container = document.getElementById("matjip-results");
    container.innerHTML = "";

    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      const row = document.createElement("div");
      row.className = "matjip-row";

      // 주소 간결화
      let addr = f.address || "";
      if (addr.includes("(")) addr = addr.substring(0, addr.indexOf("(")).trim();
      const addrParts = addr.split(" ");
      if (addrParts.length > 1 && addrParts[0].length >= 2) {
        addr = addrParts.slice(1).join(" ");
      }

      row.innerHTML = `
        <div class="matjip-row-header">
          <span class="matjip-rank matjip-rank-fav">\u2B50</span>
          <span class="matjip-name">${esc(f.name)}</span>
        </div>
        <div class="matjip-row-details">
          <span>${esc(addr)}</span>
        </div>
        ${f.memo ? `<div class="matjip-row-details"><span class="matjip-memo">${esc(f.memo)}</span></div>` : ""}
      `;

      row.addEventListener("click", () => {
        if (f.x && f.y) {
          window.postMessage(
            { source: "matjip", action: "panTo", lat: f.y, lng: f.x },
            "*"
          );
        }
        triggerKakaoSearch(f.name);
        document
          .querySelectorAll(".matjip-row.selected")
          .forEach((el) => el.classList.remove("selected"));
        row.classList.add("selected");
      });

      row.title = f.address || "";
      container.appendChild(row);
    }

    // 좌표가 있는 즐겨찾기를 지도에 마커로 표시
    const withCoords = items.filter((f) => f.x && f.y);
    if (withCoords.length > 0) {
      const markerItems = withCoords.map((f, i) => ({
        rank: i + 1,
        id: f.id,
        lat: f.y,
        lng: f.x,
        name: f.name,
        suspicion: -1,
      }));
      window.postMessage(
        { source: "matjip", action: "setMarkers", items: markerItems },
        "*"
      );
    }
  }

  // 진행 상황 수신
  if (!chrome.runtime?.id) return;
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
