export function applyTheme(theme: string): void {
  const root = document.documentElement;
  if (theme === "system") {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "dark" : "light";
    return;
  }
  root.dataset.theme = theme;
}

export function loadStoredTheme(): string {
  return localStorage.getItem("clarion-theme") ?? "system";
}

export function storeTheme(theme: string): void {
  localStorage.setItem("clarion-theme", theme);
  applyTheme(theme);
}
