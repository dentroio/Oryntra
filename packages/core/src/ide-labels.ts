import type { IdeProvider } from "./types.js";

export const IDE_PROVIDERS: IdeProvider[] = [
  "cursor",
  "vscode",
  "windsurf",
  "jetbrains",
  "zed",
  "antigravity",
  "other",
];

export const IDE_LABELS: Record<IdeProvider, string> = {
  cursor: "Cursor",
  vscode: "VS Code",
  windsurf: "Windsurf",
  jetbrains: "JetBrains",
  zed: "Zed",
  antigravity: "Antigravity",
  other: "Other IDE",
};

export function getIdeLabel(provider?: IdeProvider | string | null): string {
  if (!provider) return "IDE";
  return IDE_LABELS[provider as IdeProvider] ?? String(provider);
}

export function parseIdeProvider(
  value?: string | null,
): IdeProvider | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim();
  return IDE_PROVIDERS.includes(normalized as IdeProvider)
    ? (normalized as IdeProvider)
    : undefined;
}
