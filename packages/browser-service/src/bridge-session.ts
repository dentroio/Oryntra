import { mkdir } from "node:fs/promises";
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
import {
  BridgeCaptureCoordinator,
  type BridgeCaptureUpload,
} from "./bridge-capture.js";
import { buildElementRef, type RawElementData } from "./element.js";

export type BridgeEventPayload =
  | {
      type: "click";
      route: string;
      title: string;
      mouse: { x: number; y: number };
      element?: RawElementData | null;
    }
  | {
      type: "mouse_sample";
      route: string;
      mouse: { x: number; y: number };
      element?: RawElementData | null;
    }
  | {
      type: "navigation";
      route: string;
      title: string;
    }
  | {
      type: "console_error";
      route: string;
      message: string;
    }
  | {
      type: "network_error";
      route: string;
      url: string;
      status?: number;
      message?: string;
    }
  | {
      type: "viewport";
      route: string;
      width: number;
      height: number;
      scrollX?: number;
      scrollY?: number;
    };

export type BridgeSessionOptions = {
  sessionId: string;
  appUrl: string;
  config: OryntraConfig;
  onEvent: (event: BrowserEvent) => void;
};

export class BridgeSession {
  readonly sessionId: string;
  private readonly appUrl: string;
  private readonly config: OryntraConfig;
  private readonly onEvent: (event: BrowserEvent) => void;
  private readonly captureCoordinator = new BridgeCaptureCoordinator();
  private mouse = { x: 0, y: 0 };
  private route = "";
  private title = "";
  private viewport = {
    width: 1280,
    height: 800,
    scrollX: 0,
    scrollY: 0,
  };
  private lastClickedElement?: ElementRef;
  private lockedElement?: ElementRef;
  private reviewMode: ReviewMode = "normal";
  private consoleErrors: string[] = [];
  private networkErrors: Array<{
    url: string;
    status?: number;
    message?: string;
  }> = [];
  private started = false;

  constructor(options: BridgeSessionOptions) {
    this.sessionId = options.sessionId;
    this.appUrl = options.appUrl;
    this.config = options.config;
    this.onEvent = options.onEvent;
    this.route = options.appUrl;
    this.viewport = {
      width: options.config.browser?.viewport?.width ?? 1280,
      height: options.config.browser?.viewport?.height ?? 800,
      scrollX: 0,
      scrollY: 0,
    };
  }

  async start(): Promise<void> {
    this.started = true;
  }

  ingestBridgeEvent(payload: BridgeEventPayload): void {
    if (!this.started) return;

    if (payload.type === "navigation") {
      this.route = payload.route;
      this.title = payload.title;
      this.onEvent({
        id: createId("evt"),
        sessionId: this.sessionId,
        type: "navigation",
        timestamp: new Date().toISOString(),
        route: payload.route,
      });
      return;
    }

    if (payload.type === "viewport") {
      this.route = payload.route;
      this.viewport = {
        width: payload.width,
        height: payload.height,
        scrollX: payload.scrollX ?? 0,
        scrollY: payload.scrollY ?? 0,
      };
      return;
    }

    if (payload.type === "console_error") {
      this.consoleErrors.push(payload.message);
      this.onEvent({
        id: createId("evt"),
        sessionId: this.sessionId,
        type: "console_error",
        timestamp: new Date().toISOString(),
        route: payload.route,
        message: payload.message,
      });
      return;
    }

    if (payload.type === "network_error") {
      const entry = {
        url: payload.url,
        status: payload.status,
        message: payload.message,
      };
      this.networkErrors.push(entry);
      this.onEvent({
        id: createId("evt"),
        sessionId: this.sessionId,
        type: "network_error",
        timestamp: new Date().toISOString(),
        route: payload.route,
        url: payload.url,
        status: payload.status,
        message: payload.message,
      });
      return;
    }

    if (payload.type === "mouse_sample") {
      this.mouse = payload.mouse;
      this.route = payload.route;
      this.onEvent({
        id: createId("evt"),
        sessionId: this.sessionId,
        type: "mouse_sample",
        timestamp: new Date().toISOString(),
        route: payload.route,
        mouse: payload.mouse,
        elementUnderPointer: buildElementRef(payload.element ?? null),
      });
      return;
    }

    if (payload.type === "click") {
      this.mouse = payload.mouse;
      this.route = payload.route;
      this.title = payload.title;
      const element = buildElementRef(payload.element ?? null);
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
        route: payload.route,
        element,
      });
    }
  }

  getPendingCapture(): { screenshotId?: string; snapshotId?: string } {
    return this.captureCoordinator.getPending();
  }

  async fulfillBridgeCapture(upload: BridgeCaptureUpload): Promise<boolean> {
    let fulfilled = false;
    if (upload.screenshotId && upload.pngBase64) {
      fulfilled =
        (await this.captureCoordinator.fulfillScreenshot(
          upload.screenshotId,
          upload.pngBase64,
        )) || fulfilled;
    }
    if (upload.snapshotId && upload.snapshotText !== undefined) {
      fulfilled =
        (await this.captureCoordinator.fulfillSnapshot(
          upload.snapshotId,
          upload.snapshotText,
        )) || fulfilled;
    }
    return fulfilled;
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
    return {
      route: this.route,
      title: this.title,
      mouse: { ...this.mouse },
      elementUnderPointer: this.lastClickedElement,
      lastClickedElement: this.lastClickedElement,
      lockedElement: this.lockedElement,
      consoleErrors: [...this.consoleErrors].slice(-20),
      networkErrors: [...this.networkErrors].slice(-20),
    };
  }

  async captureSpatialContext(): Promise<SpatialContext> {
    const elementUnderPointer = this.lastClickedElement;
    const subject =
      this.lockedElement ??
      (this.reviewMode === "explain_this"
        ? this.lastClickedElement ?? elementUnderPointer
        : this.lastClickedElement ?? undefined);

    return {
      route: this.route,
      pageTitle: this.title,
      mouse: { ...this.mouse },
      elementUnderPointer,
      lastClickedElement: this.lastClickedElement,
      lockedElement: subject,
      viewport: { ...this.viewport },
    };
  }

  async captureScreenshot(screenshotId: string): Promise<string> {
    const path = getScreenshotPath(this.sessionId, screenshotId);
    await mkdir(dirname(path), { recursive: true });
    return this.captureCoordinator.waitForScreenshot(screenshotId, path);
  }

  async captureAccessibilitySnapshot(snapshotId: string): Promise<string> {
    const path = getSnapshotPath(this.sessionId, snapshotId);
    await mkdir(dirname(path), { recursive: true });
    return this.captureCoordinator.waitForSnapshot(snapshotId, path);
  }

  async close(): Promise<void> {
    this.started = false;
  }
}
