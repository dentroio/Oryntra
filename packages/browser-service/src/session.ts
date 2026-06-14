import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createId,
  getScreenshotPath,
  getSnapshotPath,
  type BrowserEvent,
  type BrowserState,
  type ElementRef,
  type OryntraConfig,
  type ReviewMode,
  type SpatialContext,
} from "@oryntra/core";
import { chromium, type Page } from "playwright";
import {
  buildElementRef,
  ELEMENT_INIT_SCRIPT,
  type RawElementData,
} from "./element.js";

export type BrowserSessionOptions = {
  sessionId: string;
  appUrl: string;
  config: OryntraConfig;
  onEvent: (event: BrowserEvent) => void;
};

export class BrowserSession {
  readonly sessionId: string;
  private readonly appUrl: string;
  private readonly config: OryntraConfig;
  private readonly onEvent: (event: BrowserEvent) => void;
  private page: Page | null = null;
  private mouse = { x: 0, y: 0 };
  private lastClickedElement?: ElementRef;
  private lockedElement?: ElementRef;
  private reviewMode: ReviewMode = "normal";
  private consoleErrors: string[] = [];
  private networkErrors: Array<{
    url: string;
    status?: number;
    message?: string;
  }> = [];
  private mouseTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: BrowserSessionOptions) {
    this.sessionId = options.sessionId;
    this.appUrl = options.appUrl;
    this.config = options.config;
    this.onEvent = options.onEvent;
  }

  async start(): Promise<void> {
    const viewport = this.config.browser?.viewport ?? {
      width: 1280,
      height: 800,
    };
    const browser = await chromium.launch({
      headless: this.config.browser?.headless ?? false,
    });
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    this.page = page;

    await page.exposeFunction(
      "__oryntraReportClick",
      async (payload: {
        x: number;
        y: number;
        element: RawElementData | null;
      }) => {
        this.mouse = { x: payload.x, y: payload.y };
        const element = buildElementRef(payload.element);
        this.lastClickedElement = element;
        if (this.reviewMode === "element_picker" && element) {
          this.lockedElement = element;
          this.reviewMode = "normal";
        }
        this.onEvent({
          id: createId("evt"),
          sessionId: this.sessionId,
          type: "click",
          timestamp: new Date().toISOString(),
          route: this.currentRoute(),
          element,
        });
      },
    );

    await context.addInitScript(ELEMENT_INIT_SCRIPT);

    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      this.onEvent({
        id: createId("evt"),
        sessionId: this.sessionId,
        type: "navigation",
        timestamp: new Date().toISOString(),
        route: frame.url(),
      });
    });

    if (this.config.browser?.captureConsole !== false) {
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const message = msg.text();
        this.consoleErrors.push(message);
        this.onEvent({
          id: createId("evt"),
          sessionId: this.sessionId,
          type: "console_error",
          timestamp: new Date().toISOString(),
          route: this.currentRoute(),
          message,
        });
      });
    }

    if (this.config.browser?.captureNetwork !== false) {
      page.on("response", (response) => {
        const status = response.status();
        if (status < 400) return;
        const entry = {
          url: response.url(),
          status,
          message: response.statusText(),
        };
        this.networkErrors.push(entry);
        this.onEvent({
          id: createId("evt"),
          sessionId: this.sessionId,
          type: "network_error",
          timestamp: new Date().toISOString(),
          route: this.currentRoute(),
          url: entry.url,
          status: entry.status,
          message: entry.message,
        });
      });
    }

    const interval = this.config.review?.mouseSampleIntervalMs ?? 100;
    this.mouseTimer = setInterval(() => {
      void this.emitMouseSample();
    }, interval);

    await page.goto(this.appUrl, { waitUntil: "domcontentloaded" });
  }

  setReviewMode(mode: ReviewMode): void {
    this.reviewMode = mode;
    if (mode !== "element_picker") {
      this.lockedElement = undefined;
    }
  }

  getReviewMode(): ReviewMode {
    return this.reviewMode;
  }

  async getBrowserState(): Promise<BrowserState> {
    await this.syncMouseFromPage();
    const elementUnderPointer = await this.describeElementAt(
      this.mouse.x,
      this.mouse.y,
    );
    return {
      route: this.currentRoute(),
      title: (await this.page?.title()) ?? "",
      mouse: { ...this.mouse },
      elementUnderPointer,
      lastClickedElement: this.lastClickedElement,
      lockedElement: this.lockedElement,
      consoleErrors: [...this.consoleErrors].slice(-20),
      networkErrors: [...this.networkErrors].slice(-20),
    };
  }

  async captureSpatialContext(): Promise<SpatialContext> {
    const page = this.page;
    if (!page) {
      throw new Error("Browser session not started");
    }
    await this.syncMouseFromPage();
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const scroll = await page.evaluate(() => ({
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    }));
    const elementUnderPointer = await this.describeElementAt(
      this.mouse.x,
      this.mouse.y,
    );
    const subject =
      this.lockedElement ??
      (this.reviewMode === "explain_this"
        ? this.lastClickedElement ?? elementUnderPointer
        : this.lastClickedElement ?? undefined);

    return {
      route: this.currentRoute(),
      pageTitle: await page.title(),
      mouse: { ...this.mouse },
      elementUnderPointer,
      lastClickedElement: this.lastClickedElement,
      lockedElement: subject,
      viewport: {
        width: viewport.width,
        height: viewport.height,
        scrollX: scroll.scrollX,
        scrollY: scroll.scrollY,
      },
    };
  }

  async captureScreenshot(screenshotId: string): Promise<string> {
    const page = this.page;
    if (!page) throw new Error("Browser session not started");
    const path = getScreenshotPath(this.sessionId, screenshotId);
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, fullPage: false });
    return path;
  }

  async captureAccessibilitySnapshot(snapshotId: string): Promise<string> {
    const page = this.page;
    if (!page) throw new Error("Browser session not started");
    let snapshot: string;
    try {
      snapshot = await page.locator("body").ariaSnapshot();
    } catch {
      snapshot = JSON.stringify({
        url: page.url(),
        title: await page.title(),
      });
    }
    const path = getSnapshotPath(this.sessionId, snapshotId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, snapshot, "utf8");
    return path;
  }

  async close(): Promise<void> {
    if (this.mouseTimer) clearInterval(this.mouseTimer);
    await this.page?.context().browser()?.close();
    this.page = null;
  }

  private currentRoute(): string {
    try {
      return this.page?.url() ?? this.appUrl;
    } catch {
      return this.appUrl;
    }
  }

  private async emitMouseSample(): Promise<void> {
    const page = this.page;
    if (!page) return;
    await this.syncMouseFromPage();
    const elementUnderPointer = await this.describeElementAt(
      this.mouse.x,
      this.mouse.y,
    );
    this.onEvent({
      id: createId("evt"),
      sessionId: this.sessionId,
      type: "mouse_sample",
      timestamp: new Date().toISOString(),
      route: this.currentRoute(),
      mouse: { ...this.mouse },
      elementUnderPointer,
    });
  }

  private async syncMouseFromPage(): Promise<void> {
    const page = this.page;
    if (!page) return;
    try {
      const pos = await page.evaluate(
        () => window.__oryntraMouse ?? { x: 0, y: 0 },
      );
      this.mouse = pos;
    } catch {
      // Page may be navigating; keep last known mouse position.
    }
  }

  private async describeElementAt(
    x: number,
    y: number,
  ): Promise<ElementRef | undefined> {
    const page = this.page;
    if (!page) return undefined;
    this.mouse = { x, y };
    try {
      const raw = await page.evaluate(
        ({ px, py }) => window.__oryntraDescribeAt?.(px, py) ?? null,
        { px: x, py: y },
      );
      return buildElementRef(raw);
    } catch {
      return undefined;
    }
  }
}

declare global {
  interface Window {
    __oryntraMouse?: { x: number; y: number };
    __oryntraDescribeAt?: (x: number, y: number) => RawElementData | null;
  }
}
