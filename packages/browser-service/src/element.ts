import type { ElementRef } from "@oryntra/core";

export type RawElementData = {
  selector: string;
  role?: string;
  name?: string;
  text?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  domPath?: string;
};

export function buildElementRef(data: RawElementData | null): ElementRef | undefined {
  if (!data) return undefined;
  return {
    selector: data.selector,
    role: data.role,
    name: data.name,
    text: data.text,
    boundingBox: data.boundingBox,
    domPath: data.domPath,
  };
}

export const ELEMENT_INIT_SCRIPT = `
(() => {
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 8) {
      let part = el.tagName.toLowerCase();
      if (el.id) {
        part += "#" + el.id;
        parts.unshift(part);
        break;
      }
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === el.tagName,
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(el) + 1;
          part += ":nth-of-type(" + index + ")";
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

  window.__oryntraDescribeElement = describeElement;
  window.__oryntraMouse = { x: 0, y: 0 };
  window.addEventListener(
    "mousemove",
    (e) => {
      window.__oryntraMouse = { x: e.clientX, y: e.clientY };
    },
    { passive: true },
  );
  window.__oryntraDescribeAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return describeElement(el);
  };

  function reportClick(event) {
    const target = event;
    const element =
      window.__oryntraDescribeAt?.(target.clientX, target.clientY) ?? null;
    void window.__oryntraReportClick?.({
      x: target.clientX,
      y: target.clientY,
      element,
    });
  }

  document.addEventListener("click", reportClick, true);
})();
`;
