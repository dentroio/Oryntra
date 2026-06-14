(function () {
  function runtimeAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  // After extension reload, the old content script must not block a fresh inject.
  if (window.__oryntraExtensionLoaded && runtimeAlive()) return;
  window.__oryntraExtensionLoaded = true;

  let sessionId = null;
  let bound = false;
  let lastSyncedRoute = "";
  let routePollTimer = null;
  let contextDead = false;

  function stopCapture(reason) {
    bound = false;
    sessionId = null;
    contextDead = reason === "invalidated";
    if (routePollTimer) {
      clearInterval(routePollTimer);
      routePollTimer = null;
    }
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 8) {
      let part = el.tagName.toLowerCase();
      if (el.id) {
        parts.unshift(part + "#" + el.id);
        break;
      }
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === el.tagName,
        );
        if (siblings.length > 1) {
          part += ":nth-of-type(" + (siblings.indexOf(el) + 1) + ")";
        }
      }
      parts.unshift(part);
      el = parent;
    }
    return parts.join(" > ");
  }

  function describeElement(el) {
    if (!el || el.nodeType !== 1) return null;
    const rect = el.getBoundingClientRect();
    const role = el.getAttribute("role") || el.tagName.toLowerCase();
    const name =
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      (el.textContent || "").trim().slice(0, 80) ||
      undefined;
    const testId = el.getAttribute("data-testid");
    const selector = testId
      ? '[data-testid="' + testId + '"]'
      : cssPath(el);
    return {
      selector,
      role,
      name,
      text: (el.textContent || "").trim().slice(0, 120) || undefined,
      boundingBox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      domPath: cssPath(el),
    };
  }

  function describeAt(x, y) {
    return describeElement(document.elementFromPoint(x, y));
  }

  function post(payload) {
    if (!sessionId || contextDead) return;
    if (!runtimeAlive()) {
      stopCapture("invalidated");
      return;
    }
    try {
      chrome.runtime.sendMessage(
        {
          type: "oryntra_bridge_event",
          sessionId,
          payload,
        },
        function () {
          void chrome.runtime.lastError;
        },
      );
    } catch {
      stopCapture("invalidated");
    }
  }

  function routePayload() {
    return { route: location.href, title: document.title };
  }

  function postViewport() {
    post({
      type: "viewport",
      route: location.href,
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    });
  }

  function syncRouteIfChanged() {
    if (!sessionId || !bound || contextDead) return;
    if (!runtimeAlive()) {
      stopCapture("invalidated");
      return;
    }
    const href = location.href;
    if (href === lastSyncedRoute) return;
    lastSyncedRoute = href;
    onNavigate();
  }

  function startCapture() {
    if (bound || contextDead) return;
    bound = true;
    lastSyncedRoute = "";
    postViewport();
    syncRouteIfChanged();
    if (!routePollTimer) {
      routePollTimer = setInterval(syncRouteIfChanged, 500);
    }
  }

  async function syncSession() {
    if (!runtimeAlive()) {
      stopCapture("invalidated");
      return;
    }
    let data;
    try {
      data = await chrome.storage.local.get(["sessionId", "appUrl"]);
    } catch {
      stopCapture("invalidated");
      return;
    }
    const nextSession = data.sessionId ?? null;
    const appUrl = data.appUrl ?? "";
    if (!nextSession || !appUrl) {
      sessionId = null;
      bound = false;
      return;
    }
    try {
      const current = new URL(location.href);
      const expected = new URL(appUrl);
      if (current.origin !== expected.origin) {
        sessionId = null;
        bound = false;
        return;
      }
    } catch {
      sessionId = null;
      bound = false;
      return;
    }
    contextDead = false;
    sessionId = nextSession;
    try {
      chrome.runtime.sendMessage({ type: "oryntra_bind_tab" }, function () {
        void chrome.runtime.lastError;
      });
    } catch {
      stopCapture("invalidated");
      return;
    }
    startCapture();
  }

  document.addEventListener(
    "click",
    function (event) {
      post({
        type: "click",
        ...routePayload(),
        mouse: { x: event.clientX, y: event.clientY },
        element: describeAt(event.clientX, event.clientY),
      });
    },
    true,
  );

  document.addEventListener(
    "mousemove",
    function (event) {
      if (window.__oryntraMouseTimer) return;
      window.__oryntraMouseTimer = window.setTimeout(function () {
        window.__oryntraMouseTimer = null;
        post({
          type: "mouse_sample",
          route: location.href,
          mouse: { x: event.clientX, y: event.clientY },
          element: describeAt(event.clientX, event.clientY),
        });
      }, 100);
    },
    { passive: true },
  );

  function onNavigate() {
    post({ type: "navigation", ...routePayload() });
    postViewport();
  }

  var originalPush = history.pushState;
  history.pushState = function () {
    originalPush.apply(this, arguments);
    onNavigate();
  };
  var originalReplace = history.replaceState;
  history.replaceState = function () {
    originalReplace.apply(this, arguments);
    onNavigate();
  };
  window.addEventListener("popstate", onNavigate);
  window.addEventListener("hashchange", onNavigate);
  window.addEventListener("resize", postViewport);
  window.addEventListener("scroll", postViewport, { passive: true });

  window.addEventListener("error", function (event) {
    post({
      type: "console_error",
      route: location.href,
      message: String(event.message || "Script error"),
    });
  });

  var originalFetch = window.fetch;
  window.fetch = async function () {
    var url = String(arguments[0]);
    try {
      var response = await originalFetch.apply(this, arguments);
      if (!response.ok) {
        post({
          type: "network_error",
          route: location.href,
          url: url,
          status: response.status,
        });
      }
      return response;
    } catch (error) {
      post({
        type: "network_error",
        route: location.href,
        url: url,
        message: String(error),
      });
      throw error;
    }
  };

  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.sessionId || changes.appUrl) {
      void syncSession();
    }
  });

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message) return;
    if (message.type === "oryntra_bind") {
      contextDead = false;
      sessionId = message.sessionId ?? sessionId;
      void syncSession();
      return;
    }
    if (message.type === "oryntra_resync") {
      contextDead = false;
      void syncSession();
    }
  });

  void syncSession();
})();
