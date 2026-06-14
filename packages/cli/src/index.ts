#!/usr/bin/env node
import { resolve } from "node:path";
import { loadOryntraConfig } from "@oryntra/core";
import { createApp } from "@oryntra/server";
import { Command } from "commander";
import { collaborateNow } from "./collaborate.js";
import { openReviewAgent } from "./open-review-agent.js";
import { openCollaborationRoom, openInBrowser } from "./launcher.js";

const program = new Command();

program
  .name("oryntra")
  .description("Live AI product review room for coding agents")
  .version("0.1.0");

program
  .command("start")
  .description("Start an Oryntra review session")
  .requiredOption("--workspace <path>", "Workspace root path")
  .option("--url <url>", "App URL to review")
  .option("--dev-command <cmd>", "Dev server command")
  .option("--ide <ide>", "IDE identifier", "cursor")
  .option("--port <port>", "Backend port", "4317")
  .option("--host <host>", "Backend host", "127.0.0.1")
  .option("--open", "Open Review Room in default browser", true)
  .option("--no-open", "Do not open Review Room")
  .option(
    "--embedded",
    "Single-window mode: app embedded in Review Room (default)",
    true,
  )
  .option("--playwright", "Separate Playwright Chromium window")
  .action(async (options) => {
    const workspacePath = resolve(options.workspace);
    const config = await loadOryntraConfig(workspacePath);
    const host = options.host as string;
    const port = Number(options.port);
    const appUrl = (options.url as string | undefined) ?? config.app.url;

    const { app, manager } = await createApp({ host, port });
    await app.listen({ host, port });

    const captureMode = options.playwright ? "playwright" : "embedded";

    const session = await manager.createSession({
      workspacePath,
      appUrl,
      devCommand: options.devCommand ?? config.app.devCommand,
      ide: options.ide,
      captureMode,
    });

    console.log("");
    console.log("Oryntra session started");
    console.log(`  Session ID:   ${session.sessionId}`);
    console.log(`  Review Room:  ${session.reviewRoomUrl}`);
    console.log(`  App URL:      ${appUrl}`);
    console.log("");
    if (captureMode === "embedded") {
      console.log("Collaborative mode: app is embedded in the Review Room.");
    } else {
      console.log("Navigate the Chromium window, then use the Review Room to chat.");
    }
    console.log("");
    console.log("Cursor MCP: see docs/MCP_SETUP.md");
    console.log(`  Session ID for MCP: ${session.sessionId}`);

    if (options.open) {
      await openInBrowser(session.reviewRoomUrl).catch(() => {
        console.log(`Open manually: ${session.reviewRoomUrl}`);
      });
    }
  });

program
  .command("open")
  .description(
    "Open the collaboration room from Cursor or VS Code (starts server if needed)",
  )
  .option("--workspace <path>", "Workspace root", process.cwd())
  .option("--url <url>", "App URL to review")
  .option("--dev-command <cmd>", "Dev server command")
  .option("--ide <ide>", "IDE identifier", "cursor")
  .option("--port <port>", "Backend port", "4317")
  .option("--host <host>", "Backend host", "127.0.0.1")
  .option("--open", "Open Review Room (editor or browser)", true)
  .option("--no-open", "Do not open Review Room")
  .option("--browser", "Open in system browser (default)", true)
  .option(
    "--in-editor",
    "Also notify Cursor CLI (browser still opens — Simple Browser needs Cmd+Shift+P paste)",
  )
  .option("--no-reuse", "Always create a new session")
  .option("--embedded", "Embed app in Review Room (default)", true)
  .option("--playwright", "Separate Playwright Chromium window")
  .option("--json", "Print machine-readable result")
  .action(async (options) => {
    const workspacePath = resolve(options.workspace as string);
    const host = options.host as string;
    const port = Number(options.port);
    const captureMode = options.playwright ? "playwright" : "embedded";

    const openTarget = !options.open
      ? "none"
      : options.inEditor
        ? "editor"
        : "browser";

    const result = await openCollaborationRoom({
      workspacePath,
      appUrl: options.url as string | undefined,
      devCommand: options.devCommand as string | undefined,
      ide: options.ide as "cursor" | "vscode" | "other",
      captureMode,
      host,
      port,
      openTarget,
      reuseActive: options.reuse,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log("");
    console.log(
      result.reused
        ? "Oryntra collaboration room (existing session)"
        : "Oryntra collaboration room opened",
    );
    console.log(`  Session ID:   ${result.sessionId}`);
    console.log(`  Review Room:  ${result.reviewRoomUrl}`);
    if (result.serverStarted) {
      console.log("  Server:       started in background");
    }
    if (result.openedIn === "browser") {
      console.log("  Opened in:    your default browser");
      if (result.urlCopied) {
        console.log("  URL copied — Cmd+Shift+P → Simple Browser: Show → paste for in-IDE");
      }
    } else if (result.openedIn === "failed") {
      console.log("  Open manually: paste the Review Room URL above");
    }
    console.log("");
    console.log("In Cursor chat: Process my latest Oryntra review feedback");
    console.log("");
  });

program
  .command("collaborate")
  .description(
    "One step into review — resumes your session, opens Review Room in Cursor (app can keep running)",
  )
  .option("--workspace <path>", "App workspace", process.cwd())
  .option("--url <url>", "App URL (default from oryntra.yaml)")
  .option("--fresh", "Start a new session instead of resuming")
  .option("--restart-server", "Restart Oryntra backend (pick up latest build)")
  .option("--json", "Machine-readable output")
  .action(async (options) => {
    const result = await collaborateNow({
      workspacePath: resolve(options.workspace as string),
      appUrl: options.url as string | undefined,
      fresh: options.fresh,
      restartServer: options.restartServer,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log("");
    console.log("Collaboration room ready");
    console.log(`  Review Room:  ${result.reviewRoomUrl}`);
    console.log(`  App:          ${result.appUrl} ${result.appRunning ? "(running)" : "(not running — start dev server)"}`);
    console.log(`  Session:      ${result.reused ? "resumed" : "new"} (${result.sessionId})`);
    if (result.openHint) console.log(`  ${result.openHint}`);
    console.log("");
    console.log(result.nextStep);
    console.log(`  ${result.historyHint}`);
    if (result.historyOpened) {
      console.log(`  Opened in Cursor: ${result.historyPath}`);
    } else {
      console.log(`  Open manually in Cursor: ${result.historyPath}`);
    }
    if (result.agentHint) console.log(`  ${result.agentHint}`);
    if (process.env.ORYNTRA_VERBOSE && result.cursorAgent?.resumeCommand) {
      console.log(`  Agent resume: ${result.cursorAgent.resumeCommand}`);
    }
    console.log("");
  });

program
  .command("open-review-agent")
  .description(
    "Open review-history.md in Cursor (full Review Studio log for this workspace)",
  )
  .option("--workspace <path>", "App workspace", process.cwd())
  .action(async (options) => {
    const result = await openReviewAgent({
      workspacePath: resolve(options.workspace as string),
    });
    if (!result.started) {
      console.error(result.reason ?? "Could not open review history");
      process.exitCode = 1;
      return;
    }
    console.log(`Opened: ${result.historyPath}`);
    if (result.command) {
      console.log(
        "Optional — resume background Oryntra agent in terminal:",
      );
      console.log(`  ${result.command}`);
    }
  });

await program.parseAsync(process.argv);
