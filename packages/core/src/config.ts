import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export type OryntraConfig = {
  project: { name: string; root: string };
  app: {
    url: string;
    devCommand?: string;
    healthCheckUrl?: string;
  };
  ide?: { preferred?: string; openDiffsInIde?: boolean };
  review?: {
    captureScreenshot?: boolean;
    captureAccessibilitySnapshot?: boolean;
    mouseSampleIntervalMs?: number;
    recentEventWindowSeconds?: number;
    recentEventMaxCount?: number;
  };
  agent?: {
    facilitatorProvider?: string;
    executionProvider?: string;
    autoImplementOnApprove?: boolean;
    implementInWorkspace?: boolean;
    /** Mirror Review Studio chat into a Cursor agent session (default: true) */
    cursorAgent?: boolean;
    /** Spawn interactive Cursor agent when collaboration starts (default: true) */
    openCursorAgentOnCollaborate?: boolean;
  };
  browser?: {
    mode?: "playwright" | "embedded" | "extension";
    headless?: boolean;
    viewport?: { width: number; height: number };
    captureConsole?: boolean;
    captureNetwork?: boolean;
  };
  artifacts?: { enabled?: string[] };
  tests?: {
    testCommand?: string;
    lintCommand?: string;
    e2eCommand?: string;
  };
  security?: {
    workspaceOnly?: boolean;
    localhostOnly?: boolean;
    requireApprovalBeforePatch?: boolean;
    requireApprovalBeforeShell?: boolean;
    redactSecrets?: boolean;
    allowPublicTunnel?: boolean;
    commandAllowlist?: string[];
  };
};

const DEFAULT_CONFIG: OryntraConfig = {
  project: { name: "app", root: "." },
  app: { url: "http://localhost:3000" },
  review: {
    captureScreenshot: true,
    captureAccessibilitySnapshot: true,
    mouseSampleIntervalMs: 100,
    recentEventWindowSeconds: 60,
    recentEventMaxCount: 5,
  },
  browser: {
    mode: "embedded",
    headless: false,
    viewport: { width: 1280, height: 800 },
    captureConsole: true,
    captureNetwork: true,
  },
  security: {
    workspaceOnly: true,
    localhostOnly: true,
    requireApprovalBeforePatch: true,
    requireApprovalBeforeShell: true,
    redactSecrets: true,
    allowPublicTunnel: false,
  },
};

export async function loadOryntraConfig(
  workspacePath: string,
): Promise<OryntraConfig> {
  const configPath = join(workspacePath, "oryntra.yaml");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = parseYaml(raw) as Partial<OryntraConfig>;
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function mergeConfig(
  base: OryntraConfig,
  override: Partial<OryntraConfig>,
): OryntraConfig {
  return {
    project: { ...base.project, ...override.project },
    app: { ...base.app, ...override.app },
    ide: { ...base.ide, ...override.ide },
    review: { ...base.review, ...override.review },
    agent: { ...base.agent, ...override.agent },
    browser: {
      ...base.browser,
      ...override.browser,
      viewport: {
        width:
          override.browser?.viewport?.width ??
          base.browser?.viewport?.width ??
          1280,
        height:
          override.browser?.viewport?.height ??
          base.browser?.viewport?.height ??
          800,
      },
    },
    artifacts: { ...base.artifacts, ...override.artifacts },
    tests: { ...base.tests, ...override.tests },
    security: { ...base.security, ...override.security },
  };
}
