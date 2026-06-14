(function () {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("oryntra_session");
  const apiBase = params.get("oryntra_api") || "http://127.0.0.1:4317";
  if (!sessionId) return;

  let html2canvasPromise = null;

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
    const el = document.elementFromPoint(x, y);
    return describeElement(el);
  }

  function post(payload) {
    fetch(apiBase + "/api/sessions/" + sessionId + "/bridge-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function () {});
  }

  function routePayload() {
    return {
      route: window.location.href,
      title: document.title,
    };
  }

  function postViewport() {
    post({
      type: "viewport",
      route: window.location.href,
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    });
  }

  function loadHtml2Canvas() {
    if (html2canvasPromise) return html2canvasPromise;
    html2canvasPromise = new Promise(function (resolve, reject) {
      if (window.html2canvas) {
        resolve(window.html2canvas);
        return;
      }
      var script = document.createElement("script");
      script.src = apiBase + "/oryntra-html2canvas.js";
      script.async = true;
      script.onload = function () {
        if (window.html2canvas) resolve(window.html2canvas);
        else reject(new Error("html2canvas unavailable"));
      };
      script.onerror = function () {
        reject(new Error("html2canvas load failed"));
      };
      document.head.appendChild(script);
    });
    return html2canvasPromise;
  }

  function captureAccessibilitySnapshot() {
    var lines = [];
    function walk(el, depth) {
      if (!el || el.nodeType !== 1 || depth > 12 || lines.length > 400) return;
      var tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript") return;
      var role = el.getAttribute("role") || tag;
      var name =
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        el.getAttribute("title") ||
        (el.textContent || "").trim().slice(0, 80);
      if (name || role === "button" || role === "link" || role === "input") {
        lines.push(
          "  ".repeat(depth) +
            role +
            (name ? ': "' + name.replace(/\s+/g, " ") + '"' : ""),
        );
      }
      for (var i = 0; i < el.children.length; i++) {
        walk(el.children[i], depth + 1);
      }
    }
    walk(document.body, 0);
    return (
      "url: " +
      window.location.href +
      "\ntitle: " +
      document.title +
      "\n\n" +
      lines.join("\n")
    );
  }

  async function captureViewportPng() {
    try {
      var html2canvas = await loadHtml2Canvas();
      var canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        logging: false,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        x: window.scrollX,
        y: window.scrollY,
      });
      return canvas.toDataURL("image/png").split(",")[1];
    } catch {
      return null;
    }
  }

  async function fulfillPendingCapture() {
    var res = await fetch(
      apiBase + "/api/sessions/" + sessionId + "/bridge-capture/pending",
    );
    if (!res.ok) return;
    var pending = await res.json();
    if (!pending.screenshotId && !pending.snapshotId) return;

    var body = {};
    if (pending.screenshotId) {
      var pngBase64 = await captureViewportPng();
      if (pngBase64) body.screenshotId = pending.screenshotId;
      if (pngBase64) body.pngBase64 = pngBase64;
    }
    if (pending.snapshotId) {
      body.snapshotId = pending.snapshotId;
      body.snapshotText = captureAccessibilitySnapshot();
    }
    if (!body.screenshotId && !body.snapshotId) return;

    await fetch(apiBase + "/api/sessions/" + sessionId + "/bridge-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
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
          route: window.location.href,
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
      route: window.location.href,
      message: String(event.message || "Script error"),
    });
  });

  window.addEventListener("unhandledrejection", function (event) {
    post({
      type: "console_error",
      route: window.location.href,
      message: String(event.reason || "Unhandled rejection"),
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
          route: window.location.href,
          url: url,
          status: response.status,
        });
      }
      return response;
    } catch (error) {
      post({
        type: "network_error",
        route: window.location.href,
        url: url,
        message: String(error),
      });
      throw error;
    }
  };

  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__oryntraUrl = String(url);
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("loadend", function () {
      if (this.status >= 400) {
        post({
          type: "network_error",
          route: window.location.href,
          url: this.__oryntraUrl || "",
          status: this.status,
        });
      }
    });
    return originalSend.apply(this, arguments);
  };

  window.addEventListener("message", function (event) {
    if (!event.data || event.data.type !== "oryntra_check_capture") return;
    void fulfillPendingCapture();
  });

  window.setInterval(function () {
    void fulfillPendingCapture();
  }, 300);

  onNavigate();
})();
