import { useEffect, useState } from "react";
import { applyTheme, loadStoredTheme, storeTheme } from "../theme";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    const stored = loadStoredTheme();
    if (stored === "dark") return true;
    if (stored === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const stored = loadStoredTheme();
    setIsDark(
      stored === "dark" ||
        (stored === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches),
    );
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    storeTheme(next ? "dark" : "light");
    applyTheme(next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      data-testid="theme-toggle"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? "☀ Light" : "☾ Dark"}
    </button>
  );
}
