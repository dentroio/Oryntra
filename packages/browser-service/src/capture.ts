import type {
  BrowserEvent,
  BrowserState,
  OryntraConfig,
  ReviewMode,
  SpatialContext,
} from "@oryntra/core";
import type { BridgeEventPayload } from "./bridge-session.js";
import type { BridgeCaptureUpload } from "./bridge-capture.js";
import { BridgeSession } from "./bridge-session.js";
import { BrowserSession } from "./session.js";

export type BrowserCapture = {
  start(): Promise<void>;
  close(): Promise<void>;
  setReviewMode(mode: ReviewMode): void;
  getReviewMode(): ReviewMode;
  getBrowserState(): Promise<BrowserState>;
  captureSpatialContext(): Promise<SpatialContext>;
  captureScreenshot(screenshotId: string): Promise<string>;
  captureAccessibilitySnapshot(snapshotId: string): Promise<string>;
  ingestBridgeEvent?(payload: BridgeEventPayload): void;
  getPendingCapture?(): { screenshotId?: string; snapshotId?: string };
  fulfillBridgeCapture?(upload: BridgeCaptureUpload): Promise<boolean>;
};

export type CaptureMode = "playwright" | "embedded" | "extension";

export function createBrowserCapture(options: {
  mode: CaptureMode;
  sessionId: string;
  appUrl: string;
  config: OryntraConfig;
  onEvent: (event: BrowserEvent) => void;
}): BrowserCapture {
  if (options.mode === "embedded" || options.mode === "extension") {
    return new BridgeSession(options);
  }
  return new BrowserSession(options);
}
