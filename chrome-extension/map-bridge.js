// Runs in MAIN world — has access to kakao.maps on the page.
// Captures the map instance via constructor interception + prototype patching.
(function () {
  let mapInstance = null;
  let overlays = [];
  let pendingCommands = [];

  // --- Strategy 1: Intercept kakao.maps.Map constructor ---
  function interceptConstructor() {
    if (typeof kakao === "undefined" || !kakao.maps || !kakao.maps.Map) return;
    if (kakao.maps.Map.__matjip) return;

    const Orig = kakao.maps.Map;
    try {
      kakao.maps.Map = new Proxy(Orig, {
        construct(target, args, newTarget) {
          const instance = Reflect.construct(target, args, newTarget);
          if (!mapInstance) {
            mapInstance = instance;
            processPending();
          }
          return instance;
        },
      });
      kakao.maps.Map.prototype = Orig.prototype;
      kakao.maps.Map.__matjip = true;
    } catch (e) {
      // CSP or frozen object — fall through to other strategies
    }
  }

  // --- Strategy 2: Search globals ---
  function searchGlobals() {
    if (typeof kakao === "undefined" || !kakao.maps) return null;

    const names = ["map", "Map", "_map", "mainMap", "kakaoMap", "mapObj"];
    for (const n of names) {
      try {
        if (window[n] instanceof kakao.maps.Map) return window[n];
      } catch (e) {}
    }
    for (const key of Object.getOwnPropertyNames(window)) {
      try {
        if (window[key] instanceof kakao.maps.Map) return window[key];
      } catch (e) {}
    }
    // Also check daum namespace
    if (typeof daum !== "undefined" && daum.maps) {
      for (const key of Object.getOwnPropertyNames(window)) {
        try {
          if (window[key] instanceof daum.maps.Map) return window[key];
        } catch (e) {}
      }
    }
    return null;
  }

  // --- Strategy 3: Patch prototype to capture on next method call ---
  function patchPrototype() {
    if (typeof kakao === "undefined" || !kakao.maps) return;

    const methods = [
      "getCenter",
      "getLevel",
      "getBounds",
      "getMapTypeId",
      "setBounds",
      "setCenter",
      "setLevel",
      "panTo",
      "relayout",
    ];
    for (const name of methods) {
      const orig = kakao.maps.Map.prototype[name];
      if (!orig || orig.__matjip) continue;
      const wrapped = function () {
        if (!mapInstance) {
          mapInstance = this;
          restorePrototype();
          processPending();
        }
        return orig.apply(this, arguments);
      };
      wrapped.__matjip = true;
      wrapped.__orig = orig;
      kakao.maps.Map.prototype[name] = wrapped;
    }
  }

  function restorePrototype() {
    if (typeof kakao === "undefined" || !kakao.maps) return;
    const methods = [
      "getCenter",
      "getLevel",
      "getBounds",
      "getMapTypeId",
      "setBounds",
      "setCenter",
      "setLevel",
      "panTo",
      "relayout",
    ];
    for (const name of methods) {
      const fn = kakao.maps.Map.prototype[name];
      if (fn && fn.__matjip && fn.__orig) {
        kakao.maps.Map.prototype[name] = fn.__orig;
      }
    }
  }

  // --- Command processing ---

  function processPending() {
    if (!mapInstance || pendingCommands.length === 0) return;
    const cmds = pendingCommands.splice(0);
    cmds.forEach(executeCommand);
  }

  function getMap() {
    if (mapInstance) return mapInstance;
    mapInstance = searchGlobals();
    return mapInstance;
  }

  function clearOverlays() {
    overlays.forEach((o) => o.setMap(null));
    overlays = [];
  }

  function executeCommand(data) {
    if (!mapInstance) return;

    if (data.action === "panTo") {
      const pos = new kakao.maps.LatLng(data.lat, data.lng);
      mapInstance.panTo(pos);
      mapInstance.setLevel(3);
    }

    if (data.action === "setMarkers") {
      clearOverlays();
      const bounds = new kakao.maps.LatLngBounds();

      for (const item of data.items) {
        const pos = new kakao.maps.LatLng(item.lat, item.lng);
        bounds.extend(pos);

        const el = document.createElement("div");
        el.className = "matjip-map-marker";
        if (item.suspicion >= 50) el.classList.add("danger");
        else if (item.suspicion > 0) el.classList.add("warning");
        el.innerHTML =
          '<span class="rank">' +
          item.rank +
          '</span><span class="name">' +
          item.name.replace(/</g, "&lt;") +
          "</span>";

        const overlay = new kakao.maps.CustomOverlay({
          position: pos,
          content: el,
          yAnchor: 1.5,
          map: mapInstance,
        });
        overlays.push(overlay);
      }

      if (data.items.length > 1) {
        mapInstance.setBounds(bounds, 100, 100, 100, 100);
      } else if (data.items.length === 1) {
        mapInstance.setCenter(
          new kakao.maps.LatLng(data.items[0].lat, data.items[0].lng)
        );
        mapInstance.setLevel(3);
      }
    }

    if (data.action === "clearMarkers") {
      clearOverlays();
    }
  }

  // --- Message handler ---

  window.addEventListener("message", (e) => {
    if (e.data?.source !== "matjip") return;

    if (getMap()) {
      executeCommand(e.data);
    } else {
      pendingCommands.push(e.data);
      // Try to force map method calls
      patchPrototype();
      window.dispatchEvent(new Event("resize"));
    }
  });

  // --- Initialization: poll for kakao SDK, then intercept ---

  function init() {
    const poll = setInterval(() => {
      if (typeof kakao !== "undefined" && kakao.maps && kakao.maps.Map) {
        clearInterval(poll);
        interceptConstructor();
        if (!mapInstance) mapInstance = searchGlobals();
        if (!mapInstance) patchPrototype();
        if (mapInstance) processPending();
      }
    }, 100);
    setTimeout(() => clearInterval(poll), 30000);
  }

  init();
})();
