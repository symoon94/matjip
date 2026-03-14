const input = document.getElementById("apiKey");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

// 저장된 키 로드
chrome.storage.local.get(["apiKey", "favorites"], ({ apiKey, favorites }) => {
  if (apiKey) {
    input.value = apiKey;
    status.textContent = "API 키 설정됨";
  }
  if (favorites) {
    const favStatus = document.getElementById("favStatus");
    favStatus.textContent = `즐겨찾기 ${favorites.length}개 로드됨`;
  }
});

saveBtn.addEventListener("click", () => {
  const key = input.value.trim();
  if (!key) {
    status.textContent = "키를 입력해주세요";
    status.style.color = "#e74c3c";
    return;
  }
  chrome.storage.local.set({ apiKey: key }, () => {
    status.textContent = "저장 완료!";
    status.style.color = "#27ae60";
  });
});

// 캐시 초기화
document.getElementById("clearCache").addEventListener("click", () => {
  const cacheStatus = document.getElementById("cacheStatus");
  chrome.runtime.sendMessage({ type: "clearCache" }, () => {
    cacheStatus.textContent = "캐시 초기화 완료!";
    cacheStatus.style.color = "#27ae60";
  });
});

// 즐겨찾기 초기화
document.getElementById("clearFav").addEventListener("click", () => {
  const favStatus = document.getElementById("favStatus");
  chrome.storage.local.remove("favorites", () => {
    favStatus.textContent = "즐겨찾기 초기화 완료 (0개)";
    favStatus.style.color = "#e74c3c";
  });
});

// 즐겨찾기 파일 가져오기
document.getElementById("favFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const favStatus = document.getElementById("favStatus");

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error("배열이 아닙니다");
      chrome.storage.local.set({ favorites: data }, () => {
        if (chrome.runtime.lastError) {
          favStatus.textContent = "저장 실패: " + chrome.runtime.lastError.message;
          favStatus.style.color = "#e74c3c";
          return;
        }
        // 저장 검증
        chrome.storage.local.get("favorites", ({ favorites }) => {
          if (!favorites || favorites.length !== data.length) {
            favStatus.textContent = `저장 실패: ${data.length}개 중 ${(favorites || []).length}개만 저장됨`;
            favStatus.style.color = "#e74c3c";
          } else {
            favStatus.textContent = `즐겨찾기 ${favorites.length}개 저장 완료!`;
            favStatus.style.color = "#27ae60";
          }
        });
      });
    } catch (err) {
      favStatus.textContent = "파일 형식 오류: " + err.message;
      favStatus.style.color = "#e74c3c";
    }
  };
  reader.readAsText(file);
});
