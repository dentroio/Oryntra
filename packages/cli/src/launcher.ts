import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  loadOryntraConfig,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type IdeProvider,
  type ReviewSession,
} from "@oryntra/core";
import {
  checkHealth,
  restartServerDaemon,
  spawnServerDaemon,
  waitForHealth,
} from "./daemon.js";

const execAsync = promisify(exec);

export type OpenTarget = "browser" | "editor" | "none";

export type OpenCollaborationRoomOptions = {
  workspacePath: string;
  appUrl?: string;
  devCommand?: string;
  ide?: IdeProvider;
  captureMode?: "embedded" | "playwright" | "extension";
  host?: string;
  port?: number;
  openTarget?: OpenTarget;
  reuseActive?: boolean;
  restartServer?: boolean;
};

export type OpenCollaborationRoomResult = {
  sessionId: string;
  reviewRoomUrl: string;
  status: string;
  reused: boolean;
  serverStarted: boolean;
  openedIn: OpenTarget | "failed";
  urlCopied: boolean;
};

function baseUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

function reviewRoomUrl(host: string, port: number, sessionId: string): string {
  return `${baseUrl(host, port)}/session/${sessionId}`;
}

export async function ensureServerRunning(options: {
  host: string;
  port: number;
  serverScript?: string;
}): Promise<boolean> {
  const url = baseUrl(options.host, options.port);
  if (await checkHealth(url)) return false;

  await spawnServerDaemon(options);
  await waitForHealth(url);
  return true;
}

export async function getActiveSession(
  host: string,
  port: number,
): Promise<ReviewSession | null> {
  const url = baseUrl(host, port);
  const res = await fetch(`${url}/api/sessions/active`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Active session lookup failed (${res.status})`);
  }
  return res.json() as Promise<ReviewSession>;
}

export async function createSession(
  host: string,
  port: number,
  request: CreateSessionRequest,
): Promise<CreateSessionResponse> {
  const url = baseUrl(host, port);
  const res = await fetch(`${url}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Create session failed (${res.status})`);
  }
  return res.json() as Promise<CreateSessionResponse>;
}

function findCursorBinary(): string | null {
  const candidates = [
    process.env.CURSOR_PATH,
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export async function copyReviewUrl(targetUrl: string): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      await execAsync(`printf '%s' "${targetUrl}" | pbcopy`);
      return true;
    }
    if (process.platform === "win32") {
      await execAsync(
        `powershell -NoProfile -Command "Set-Clipboard -Value '${targetUrl.replace(/'/g, "''")}'"`,
      );
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function openInBrowser(targetUrl: string): Promise<void> {
  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  await execAsync(`${openCmd} "${targetUrl}"`);
}

async function openViaCursorCli(targetUrl: string): Promise<boolean> {
  const cursor = findCursorBinary();
  if (!cursor) return false;
  try {
    await execAsync(`"${cursor}" --open-url "${targetUrl}"`);
    return true;
  } catch {
    return false;
  }
}

export async function openFileInEditor(filePath: string): Promise<boolean> {
  const cursor = findCursorBinary();
  if (!cursor) return false;
  try {
    await execAsync(`"${cursor}" -g "${filePath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function openReviewRoom(
  targetUrl: string,
  target: OpenTarget,
): Promise<{ openedIn: OpenTarget | "failed"; urlCopied: boolean }> {
  if (target === "none") {
    return { openedIn: "none", urlCopied: false };
  }

  const urlCopied = await copyReviewUrl(targetUrl);

  if (target === "editor") {
    await openViaCursorCli(targetUrl);
  }

  try {
    await openInBrowser(targetUrl);
    return { openedIn: "browser", urlCopied };
  } catch {
    return { openedIn: "failed", urlCopied };
  }
}

export async function openCollaborationRoom(
  options: OpenCollaborationRoomOptions,
): Promise<OpenCollaborationRoomResult> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4317;
  const workspacePath = resolve(options.workspacePath);
  const config = await loadOryntraConfig(workspacePath);
  const appUrl = options.appUrl ?? config.app.url;
  const captureMode =
    options.captureMode ?? config.browser?.mode ?? "embedded";
  const reuseActive = options.reuseActive ?? true;
  const openTarget =
    options.openTarget ??
    (process.env.ORYNTRA_OPEN_IN_EDITOR === "1" ? "editor" : "browser");

  let serverStarted = false;
  if (options.restartServer) {
    await restartServerDaemon({ host, port });
    serverStarted = true;
  } else {
    serverStarted = await ensureServerRunning({ host, port });
  }

  let result: Omit<OpenCollaborationRoomResult, "openedIn" | "urlCopied">;

  if (reuseActive) {
    const active = await getActiveSession(host, port);
    if (
      active &&
      resolve(active.workspacePath) === workspacePath &&
      active.appUrl === appUrl &&
      active.status !== "closed" &&
      active.status !== "failed"
    ) {
      result = {
        sessionId: active.id,
        reviewRoomUrl: reviewRoomUrl(host, port, active.id),
        status: active.status,
        reused: true,
        serverStarted,
      };
    } else {
      result = await createAndBuildResult();
    }
  } else {
    result = await createAndBuildResult();
  }

  const { openedIn, urlCopied } = await openReviewRoom(
    result.reviewRoomUrl,
    openTarget,
  );
  return { ...result, openedIn, urlCopied };

  async function createAndBuildResult(): Promise<
    Omit<OpenCollaborationRoomResult, "openedIn" | "urlCopied">
  > {
    const created = await createSession(host, port, {
      workspacePath,
      appUrl,
      devCommand: options.devCommand ?? config.app.devCommand,
      ide: options.ide,
      preferredIde: options.ide,
      captureMode,
    });
    return {
      sessionId: created.sessionId,
      reviewRoomUrl: created.reviewRoomUrl,
      status: created.status,
      reused: false,
      serverStarted,
    };
  }
}
