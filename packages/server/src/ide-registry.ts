import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type {
  IdeHeartbeatRequest,
  IdeProvider,
  IdeRegistration,
  IdeRegistrationSource,
} from "@oryntra/core";
import { IDE_LABELS } from "@oryntra/core";

const execFileAsync = promisify(execFile);

const HEARTBEAT_TTL_MS = 90_000;

type RegistryEntry = IdeRegistration & { expiresAt: number };

export class IdeRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  heartbeat(request: IdeHeartbeatRequest): IdeRegistration {
    const provider = request.provider ?? "other";
    const clientId =
      request.clientId?.trim() ||
      `${request.source ?? "mcp"}:${provider}:${request.workspacePath ?? "default"}`;
    const now = new Date().toISOString();
    const entry: RegistryEntry = {
      provider,
      clientId,
      label: request.label?.trim() || IDE_LABELS[provider],
      workspacePath: request.workspacePath,
      connected: true,
      lastHeartbeat: now,
      source: request.source ?? "mcp",
      expiresAt: Date.now() + HEARTBEAT_TTL_MS,
    };
    this.entries.set(clientId, entry);
    return this.stripExpiry(entry);
  }

  listConnected(workspacePath?: string): IdeRegistration[] {
    this.pruneExpired();
    const items = [...this.entries.values()].map((entry) => this.stripExpiry(entry));
    if (!workspacePath) {
      return items.sort((a, b) => b.lastHeartbeat.localeCompare(a.lastHeartbeat));
    }
    return items
      .filter(
        (entry) =>
          !entry.workspacePath ||
          entry.workspacePath === workspacePath ||
          workspacePath.startsWith(entry.workspacePath) ||
          entry.workspacePath.startsWith(workspacePath),
      )
      .sort((a, b) => b.lastHeartbeat.localeCompare(a.lastHeartbeat));
  }

  isConnected(workspacePath: string, provider: IdeProvider): boolean {
    return this.listConnected(workspacePath).some(
      (entry) => entry.provider === provider && entry.connected,
    );
  }

  findConnected(
    workspacePath: string,
    provider: IdeProvider,
  ): IdeRegistration | undefined {
    return this.listConnected(workspacePath).find(
      (entry) => entry.provider === provider && entry.connected,
    );
  }

  async probeInstalled(): Promise<IdeRegistration[]> {
    const probes: Array<Promise<IdeRegistration | null>> = [
      this.probeApp("cursor", "Cursor", [
        process.env.CURSOR_PATH,
        "/Applications/Cursor.app/Contents/MacOS/Cursor",
        "/Applications/Cursor.app",
      ]),
      this.probeApp("vscode", "VS Code", [
        "/Applications/Visual Studio Code.app",
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      ]),
      this.probeApp("windsurf", "Windsurf", [
        "/Applications/Windsurf.app",
        "/Applications/Windsurf.app/Contents/MacOS/Windsurf",
      ]),
      this.probeApp("zed", "Zed", [
        "/Applications/Zed.app",
        "/Applications/Zed.app/Contents/MacOS/zed",
      ]),
      this.probeApp("jetbrains", "JetBrains", [
        "/Applications/IntelliJ IDEA.app",
        "/Applications/WebStorm.app",
      ]),
      this.probeCli("vscode", "VS Code", "code", ["--version"]),
      this.probeCli("cursor", "Cursor", "cursor", ["--version"]),
    ];

    const found = (await Promise.all(probes)).filter(
      (entry): entry is IdeRegistration => entry !== null,
    );

    const byProvider = new Map<IdeProvider, IdeRegistration>();
    for (const entry of found) {
      if (!byProvider.has(entry.provider)) {
        byProvider.set(entry.provider, entry);
      }
    }
    return [...byProvider.values()];
  }

  async listAvailable(workspacePath?: string): Promise<IdeRegistration[]> {
    const connected = this.listConnected(workspacePath);
    const probed = await this.probeInstalled();
    const merged = new Map<string, IdeRegistration>();

    for (const entry of [...connected, ...probed]) {
      const key = `${entry.provider}:${entry.clientId}`;
      const existing = merged.get(key);
      if (!existing || entry.connected) {
        merged.set(key, entry);
      }
    }

    return [...merged.values()].sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }

  private async probeApp(
    provider: IdeProvider,
    label: string,
    candidates: Array<string | undefined>,
  ): Promise<IdeRegistration | null> {
    const path = candidates.find((candidate) => candidate && existsSync(candidate));
    if (!path) return null;
    return this.probeEntry(provider, label, `probe:${provider}`, "probe");
  }

  private async probeCli(
    provider: IdeProvider,
    label: string,
    binary: string,
    args: string[],
  ): Promise<IdeRegistration | null> {
    try {
      await execFileAsync(binary, args, { timeout: 3000 });
      return this.probeEntry(provider, label, `probe:${provider}:cli`, "probe");
    } catch {
      return null;
    }
  }

  private probeEntry(
    provider: IdeProvider,
    label: string,
    clientId: string,
    source: IdeRegistrationSource,
  ): IdeRegistration {
    const now = new Date().toISOString();
    return {
      provider,
      clientId,
      label,
      connected: false,
      lastHeartbeat: now,
      source,
    };
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [clientId, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(clientId);
      }
    }
  }

  private stripExpiry(entry: RegistryEntry): IdeRegistration {
    return {
      provider: entry.provider,
      clientId: entry.clientId,
      label: entry.label,
      workspacePath: entry.workspacePath,
      connected: entry.connected,
      lastHeartbeat: entry.lastHeartbeat,
      source: entry.source,
    };
  }
}
