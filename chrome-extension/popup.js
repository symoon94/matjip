const input = document.getElementById("apiKey");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

// 저장된 키 로드
chrome.storage.local.get("apiKey", ({ apiKey }) => {
  if (apiKey) {
    input.value = apiKey;
    status.textContent = "API 키 설정됨";
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
