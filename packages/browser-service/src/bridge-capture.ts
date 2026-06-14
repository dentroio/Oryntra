import { writeFile } from "node:fs/promises";

type PendingItem = {
  id: string;
  path: string;
  resolve: (path: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class BridgeCaptureCoordinator {
  private pendingScreenshot: PendingItem | null = null;
  private pendingSnapshot: PendingItem | null = null;

  waitForScreenshot(
    id: string,
    path: string,
    timeoutMs = 12_000,
  ): Promise<string> {
    return this.waitFor(
      () => this.pendingScreenshot,
      (item) => {
        this.pendingScreenshot = item;
      },
      () => {
        this.pendingScreenshot = null;
      },
      id,
      path,
      timeoutMs,
      "Bridge screenshot timeout",
    );
  }

  waitForSnapshot(
    id: string,
    path: string,
    timeoutMs = 12_000,
  ): Promise<string> {
    return this.waitFor(
      () => this.pendingSnapshot,
      (item) => {
        this.pendingSnapshot = item;
      },
      () => {
        this.pendingSnapshot = null;
      },
      id,
      path,
      timeoutMs,
      "Bridge accessibility snapshot timeout",
    );
  }

  getPending(): { screenshotId?: string; snapshotId?: string } {
    return {
      screenshotId: this.pendingScreenshot?.id,
      snapshotId: this.pendingSnapshot?.id,
    };
  }

  async fulfillScreenshot(id: string, pngBase64: string): Promise<boolean> {
    const pending = this.pendingScreenshot;
    if (!pending || pending.id !== id) return false;
    clearTimeout(pending.timer);
    this.pendingScreenshot = null;
    await writeFile(pending.path, Buffer.from(pngBase64, "base64"));
    pending.resolve(pending.path);
    return true;
  }

  async fulfillSnapshot(id: string, text: string): Promise<boolean> {
    const pending = this.pendingSnapshot;
    if (!pending || pending.id !== id) return false;
    clearTimeout(pending.timer);
    this.pendingSnapshot = null;
    await writeFile(pending.path, text, "utf8");
    pending.resolve(pending.path);
    return true;
  }

  private waitFor(
    getExisting: () => PendingItem | null,
    setPending: (item: PendingItem) => void,
    clearPending: () => void,
    id: string,
    path: string,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<string> {
    const existing = getExisting();
    if (existing) {
      clearTimeout(existing.timer);
      existing.reject(new Error("Superseded by newer capture request"));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearPending();
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      setPending({ id, path, resolve, reject, timer });
    });
  }
}

export type BridgeCaptureUpload = {
  screenshotId?: string;
  pngBase64?: string;
  snapshotId?: string;
  snapshotText?: string;
};
