import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadOryntraConfig, parseIdeProvider } from "@oryntra/core";
import { checkHealth } from "./daemon.js";
import {
  openCollaborationRoom,
  openFileInEditor,
  type OpenCollaborationRoomResult,
} from "./launcher.js";
import { createCursorChat, probeCursorAgentAuth } from "./cursor-chat.js";
import { ensureAppDevServer } from "./ensure-dev-app.js";

export type CollaborateNowOptions = {
  workspacePath?: string;
  appUrl?: string;
  fresh?: boolean;
  restartServer?: boolean;
  host?: string;
  port?: number;
  /** Skip slow cursor agent create-chat (default for MCP) */
  skipCursorAgent?: boolean;
  /** Start app dev server if not running (default true) */
  autoStartApp?: boolean;
  /** Keep focus in browser — do not open review-history.md in editor */
  skipOpenHistory?: boolean;
};

export type CollaborateNowResult = OpenCollaborationRoomResult & {
  appUrl: string;
  appRunning: boolean;
  workspacePath: string;
  nextStep: string;
  historyHint: string;
  historyOpened: boolean;
  agentHint?: string;
  openHint: string;
  historyPath: string;
  cursorAgent?: {
    cursorChatId: string;
    resumeCommand: string;
    created: boolean;
  };
};

async function isAppRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function collaborateNow(
  options: CollaborateNowOptions = {},
): Promise<CollaborateNowResult> {
  const workspacePath = resolve(
    options.workspacePath ??
      process.env.ORYNTRA_WORKSPACE ??
      process.cwd(),
  );
  const config = await loadOryntraConfig(workspacePath);
  const usesCursorCliFacilitator =
    (process.env.ORYNTRA_FACILITATOR ?? config.agent?.facilitatorProvider) ===
    "cursor";
  if (usesCursorCliFacilitator) {
    const auth = await probeCursorAgentAuth();
    if (!auth.ok) {
      console.warn(
        `  ⚠️  facilitatorProvider: cursor uses the headless CLI (not IDE login). ${auth.reason}`,
      );
    }
  }
  const appUrl = options.appUrl ?? config.app.url;
  let appRunning = await isAppRunning(appUrl);

  if (!appRunning && options.autoStartApp !== false && config.app.devCommand) {
    const dev = await ensureAppDevServer({
      workspacePath,
      appUrl,
      devCommand: config.app.devCommand,
    });
    appRunning = dev.alreadyRunning || dev.started;
  }

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4317;

  const preferredIde =
    parseIdeProvider(process.env.ORYNTRA_IDE) ??
    parseIdeProvider(config.ide?.preferred) ??
    "cursor";

  const result = await openCollaborationRoom({
    workspacePath,
    appUrl,
    devCommand: config.app.devCommand,
    ide: preferredIde,
    host,
    port,
    openTarget: "browser",
    reuseActive: !options.fresh,
    restartServer: options.restartServer,
  });

  let cursorAgent:
    | { cursorChatId: string; resumeCommand: string; created: boolean }
    | undefined;

  try {
    await fetch(
      `http://${host}:${port}/api/sessions/${result.sessionId}/review-history`,
    );
  } catch {
    // history sync is best-effort before first message
  }

  const openAgent =
    preferredIde === "cursor" &&
    options.skipCursorAgent !== true &&
    config.agent?.cursorAgent !== false &&
    config.agent?.openCursorAgentOnCollaborate !== false;

  if (openAgent) {
    try {
      const agentFile = join(workspacePath, ".oryntra", "agent-session.json");
      let chatId: string | undefined;
      if (options.fresh || !existsSync(agentFile)) {
        chatId = (await createCursorChat()) ?? undefined;
      }
      const res = await fetch(
        `http://${host}:${port}/api/sessions/${result.sessionId}/cursor-agent/ensure`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursorChatId: chatId ?? undefined }),
        },
      );
      if (res.ok) {
        cursorAgent = (await res.json()) as typeof cursorAgent;
      } else if (!chatId) {
        console.warn(
          "  Warning: could not create Cursor agent chat (cursor agent create-chat timed out)",
        );
      }
    } catch {
      // agent mirror is best-effort
    }
  }

  const historyPath = `${workspacePath}/.oryntra/review-history.md`;
  const agentPath = `${workspacePath}/.oryntra/agent-session.json`;

  let historyOpened = false;
  try {
    await fetch(
      `http://${host}:${port}/api/sessions/${result.sessionId}/review-history`,
    );
    if (options.skipOpenHistory !== true) {
      historyOpened = await openFileInEditor(historyPath);
    }
  } catch {
    // best-effort
  }

  const nextStep = appRunning
    ? "Review Studio is open — click the app, chat, then Approve. History syncs to review-history.md."
    : "Demo app did not start — check apps/demo-app dev server, then try again.";
  const historyHint = `Review history (all sessions today): ${historyPath}`;
  const agentHint = openAgent
    ? `Cursor agent sync: ${agentPath}`
    : preferredIde !== "cursor"
      ? `${preferredIde} MCP handles review via ORYNTRA_IDE=${preferredIde}`
      : undefined;

  const openHint =
    result.openedIn === "browser"
      ? result.urlCopied
        ? "Opened in your browser. URL copied — for in-IDE: Cmd+Shift+P → Simple Browser: Show → paste"
        : "Opened in your browser. For in-IDE: Cmd+Shift+P → Simple Browser: Show → paste the Review Room URL"
      : result.openedIn === "failed"
        ? `Open manually: ${result.reviewRoomUrl}`
        : "";

  return {
    ...result,
    appUrl,
    appRunning,
    workspacePath,
    nextStep,
    historyHint,
    agentHint,
    openHint,
    historyPath,
    historyOpened,
    cursorAgent,
  };
}
