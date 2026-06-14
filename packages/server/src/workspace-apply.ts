import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ReviewArtifact } from "@oryntra/core";

const DEVICES_PAGE = `import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DEVICES, type Device } from "../data";

function DeviceDrawer({
  device,
  onClose,
}: {
  device: Device;
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" onClick={onClose} data-testid="device-drawer">
      <aside
        className="drawer-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={\`\${device.name} details\`}
      >
        <header className="drawer-header">
          <h2>{device.name}</h2>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <dl className="detail-dl">
          <dt>Status</dt>
          <dd>{device.status}</dd>
          <dt>Site</dt>
          <dd>{device.site}</dd>
          <dt>ID</dt>
          <dd>{device.id}</dd>
        </dl>
      </aside>
    </div>
  );
}

export function DevicesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const siteFilter = searchParams.get("site") ?? "all";
  const statusFilter = searchParams.get("status") ?? "all";
  const selectedId = searchParams.get("device");
  const [showEmpty, setShowEmpty] = useState(false);

  const devices = useMemo(() => {
    if (showEmpty) return [];
    return DEVICES.filter((d) => {
      if (siteFilter !== "all" && d.site !== siteFilter) return false;
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      return true;
    });
  }, [siteFilter, statusFilter, showEmpty]);

  const selectedDevice = selectedId
    ? DEVICES.find((d) => d.id === selectedId)
    : undefined;

  function updateFilters(next: { site?: string; status?: string }) {
    const params = new URLSearchParams(searchParams);
    if (next.site !== undefined) {
      if (next.site === "all") params.delete("site");
      else params.set("site", next.site);
    }
    if (next.status !== undefined) {
      if (next.status === "all") params.delete("status");
      else params.set("status", next.status);
    }
    setSearchParams(params, { replace: true });
  }

  function openDevice(id: string) {
    const params = new URLSearchParams(searchParams);
    params.set("device", id);
    setSearchParams(params, { replace: true });
  }

  function closeDrawer() {
    const params = new URLSearchParams(searchParams);
    params.delete("device");
    setSearchParams(params, { replace: true });
  }

  return (
    <section className="page">
      <div className="page-header">
        <h1>Devices</h1>
        <button
          type="button"
          className="secondary"
          onClick={() => setShowEmpty((v) => !v)}
        >
          Toggle empty data
        </button>
      </div>

      <div className="filters" role="group" aria-label="Device filters">
        <label>
          Site
          <select
            value={siteFilter}
            onChange={(e) => updateFilters({ site: e.target.value })}
            data-testid="site-filter"
          >
            <option value="all">All sites</option>
            <option value="NYC">NYC</option>
            <option value="SFO">SFO</option>
            <option value="LON">LON</option>
          </select>
        </label>
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(e) => updateFilters({ status: e.target.value })}
            data-testid="status-filter"
          >
            <option value="all">All statuses</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="maintenance">Maintenance</option>
          </select>
        </label>
      </div>

      <table className="data-table" data-testid="devices-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Site</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.id}>
              <td>{device.name}</td>
              <td>
                <span className={\`pill pill-\${device.status}\`}>
                  {device.status}
                </span>
              </td>
              <td>{device.site}</td>
              <td>
                <button
                  type="button"
                  data-testid="device-details-button"
                  onClick={() => openDevice(device.id)}
                >
                  View Details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedDevice ? (
        <DeviceDrawer device={selectedDevice} onClose={closeDrawer} />
      ) : null}
    </section>
  );
}
`;

/** Canonical demo shell: Locations nav + drawer-based Devices (no full-page detail route). */
const APP_CANONICAL = `import { NavLink, Route, Routes } from "react-router-dom";
import { DevicesPage } from "./pages/DevicesPage";
import { HomePage } from "./pages/HomePage";
import { LocationsPage } from "./pages/LocationsPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">Clarion Demo</div>
        <nav className="nav">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/locations">Locations</NavLink>
          <NavLink to="/devices">Devices</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
`;

function artifactText(artifact: ReviewArtifact): string {
  if (artifact.kind === "change_request") {
    return [
      artifact.title,
      artifact.userIntent,
      artifact.expectedBehavior,
      artifact.currentBehavior,
    ].join(" ");
  }
  if (artifact.kind === "doc_update") {
    return `${artifact.summary} ${artifact.targetPath}`;
  }
  if (artifact.kind === "work_order") {
    return `${artifact.title} ${artifact.summary}`;
  }
  return `${artifact.section} ${artifact.rationale} ${artifact.proposedChanges}`;
}

function wantsDevicesDarkThemeFix(artifacts: ReviewArtifact[]): boolean {
  return artifacts.some((artifact) => {
    if (artifact.kind !== "change_request") return false;
    const text = artifactText(artifact).toLowerCase();
    return (
      /devices.*dark|dark.*devices|devices page|fix devices|polish devices|theme toggle|top bar.*toggle/.test(
        text,
      ) ||
      (text.includes("devices") &&
        text.includes("toggle") &&
        /dark|light|theme/.test(text)) ||
      (text.includes("devices") &&
        text.includes("dark") &&
        /fix|polish|bad|style|toggle|switch/.test(text))
    );
  });
}

function wantsDeviceDrawerFix(artifacts: ReviewArtifact[]): boolean {
  if (wantsDevicesDarkThemeFix(artifacts)) return false;
  return artifacts.some((artifact) => {
    if (artifact.kind !== "change_request") return false;
    const text = artifactText(artifact).toLowerCase();
    return (
      /drawer|breadcrumb|view details|full.page|full-page|detail view|nyc|site=|url param/.test(
        text,
      ) ||
      (/filter/.test(text) && /device/.test(text)) ||
      (/device/.test(text) && /navigate|navigation|back|list/.test(text))
    );
  });
}

const THEME_TS = `export function applyTheme(theme: string): void {
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
`;

const SETTINGS_PAGE_DARK = `import { useEffect, useState } from "react";
import { applyTheme, loadStoredTheme, storeTheme } from "../theme";

export function SettingsPage() {
  const [theme, setTheme] = useState(loadStoredTheme);
  const [notifications, setNotifications] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function handleSave() {
    storeTheme(theme);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section className="page">
      <h1>Settings</h1>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <label>
          Color mode
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            data-testid="theme-select"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
          />
          Enable notifications
        </label>
        <button type="submit" data-testid="save-settings-button">
          Save changes
        </button>
        {saved ? <span className="save-ok">Saved!</span> : null}
      </form>
    </section>
  );
}
`;

const MAIN_TSX_DARK = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { applyTheme, loadStoredTheme } from "./theme";
import "./styles.css";

applyTheme(loadStoredTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
`;

const DARK_CSS = `
/* Dark mode — applied via data-theme on <html> */
[data-theme="dark"] {
  color-scheme: dark;
}

[data-theme="dark"] :root,
[data-theme="dark"] body {
  background: #0f1419;
  color: #e8eaed;
}

[data-theme="dark"] .topbar,
[data-theme="dark"] .page-header,
[data-theme="dark"] .detail-card,
[data-theme="dark"] .settings-form,
[data-theme="dark"] .drawer-panel,
[data-theme="dark"] .card {
  background: #1a2030;
  border-color: #2a3344;
  color: #e8eaed;
}

[data-theme="dark"] .data-table th,
[data-theme="dark"] .data-table td {
  border-color: #2a3344;
}

[data-theme="dark"] .muted,
[data-theme="dark"] .breadcrumb,
[data-theme="dark"] .detail-dl dt {
  color: #9aa3b5;
}

[data-theme="dark"] a {
  color: #9cc4ff;
}

[data-theme="dark"] .drawer-backdrop {
  background: rgba(0, 0, 0, 0.55);
}
`;

function wantsLocationsBadgeFix(artifacts: ReviewArtifact[]): boolean {
  return artifacts.some((artifact) => {
    if (artifact.kind !== "change_request") return false;
    const text = artifactText(artifact).toLowerCase();
    return (
      /locations/.test(text) &&
      (/restore|top nav|navigation|menu|card|\/locations|missing|lost|empty/.test(
        text,
      ) ||
        !/drawer|filter|device details/.test(text))
    );
  });
}

const HOME_PAGE_WITH_LOCATIONS = `import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <section className="page">
      <h1>Welcome to Clarion Demo</h1>
      <p className="lede">
        This is the Oryntra dogfood app. It has intentional UI issues for
        product review sessions.
      </p>
      <div className="card-grid">
        <Link to="/locations" className="card">
          <h2>Locations</h2>
          <p>Sites and regions for your deployment footprint.</p>
        </Link>
        <Link to="/devices" className="card">
          <h2>Devices</h2>
          <p>Table with filters and a detail flow to review.</p>
        </Link>
        <Link to="/settings" className="card">
          <h2>Settings</h2>
          <p>Form with a save interaction to review.</p>
        </Link>
      </div>
    </section>
  );
}
`;

const LOCATIONS_PAGE = `export function LocationsPage() {
  return (
    <section className="page">
      <h1>Locations</h1>
      <p className="lede">
        Overview of sites where Clarion devices are deployed.
      </p>
      <ul className="location-list">
        <li><strong>NYC</strong> — East coast operations</li>
        <li><strong>SFO</strong> — West coast operations</li>
        <li><strong>LON</strong> — European operations</li>
      </ul>
    </section>
  );
}
`;


const LOCATIONS_BADGE_CSS = `
/* locations-badge */
.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.site-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  background: #e8f0ff;
  color: #1a4a8a;
  border: 1px solid #b8cff5;
}

[data-theme="dark"] .site-badge {
  background: #1a3050;
  color: #9cc4ff;
  border-color: #3d5f8a;
}
`;

function wantsDarkModeFix(artifacts: ReviewArtifact[]): boolean {
  if (wantsDevicesDarkThemeFix(artifacts)) return false;
  return artifacts.some((artifact) => {
    const text = artifactText(artifact).toLowerCase();
    return (
      /dark\s*mode|dark\s*theme|light\s*mode|color\s*mode|color\s*scheme|theme\s*selector/.test(
        text,
      ) && artifact.kind === "change_request"
    );
  });
}

const THEME_TOGGLE = `import { useEffect, useState } from "react";
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
`;

const APP_WITH_TOGGLE = `import { NavLink, Route, Routes } from "react-router-dom";
import { ThemeToggle } from "./components/ThemeToggle";
import { DevicesPage } from "./pages/DevicesPage";
import { DeviceDetailPage } from "./pages/DeviceDetailPage";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">Clarion Demo</div>
        <nav className="nav">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/devices">Devices</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          <ThemeToggle />
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/devices/:id" element={<DeviceDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
`;

const DEVICES_DARK_CSS = `
/* devices-dark-polish */
[data-theme="dark"] .filters label {
  color: #9aa3b5;
}

[data-theme="dark"] select {
  background: #1a2030;
  border-color: #2a3344;
  color: #e8eaed;
}

[data-theme="dark"] .data-table {
  background: #1a2030;
  border-color: #2a3344;
}

[data-theme="dark"] .data-table th {
  background: #141a24;
  color: #9aa3b5;
}

[data-theme="dark"] .data-table td {
  color: #e8eaed;
  border-bottom-color: #2a3344;
}

[data-theme="dark"] button.secondary {
  background: #243a62;
  color: #9cc4ff;
}

[data-theme="dark"] .theme-toggle {
  background: #243a62;
  color: #9cc4ff;
  margin-left: 8px;
  font-size: 0.8rem;
  padding: 6px 10px;
}

[data-theme="dark"] .pill-online {
  background: #1a3d2a;
  color: #7dcea0;
}

[data-theme="dark"] .pill-offline {
  background: #3d1a1a;
  color: #f5a8a8;
}

[data-theme="dark"] .pill-maintenance {
  background: #3d2e14;
  color: #e8c27a;
}
`;

export function canApplyWorkspaceFix(artifacts: ReviewArtifact[]): boolean {
  return (
    wantsDevicesDarkThemeFix(artifacts) ||
    wantsDeviceDrawerFix(artifacts) ||
    wantsDarkModeFix(artifacts) ||
    wantsLocationsBadgeFix(artifacts)
  );
}

/** @deprecated use canApplyWorkspaceFix */
export function canApplyDeviceDrawerFix(artifacts: ReviewArtifact[]): boolean {
  return canApplyWorkspaceFix(artifacts);
}

export async function applyApprovedWorkspaceChanges(options: {
  codeRoot: string;
  artifacts: ReviewArtifact[];
  onStep?: (step: string) => void;
}): Promise<{ applied: boolean; summary?: string; steps: string[] }> {
  const srcDir = join(options.codeRoot, "src");

  if (wantsDevicesDarkThemeFix(options.artifacts)) {
    const steps = [
      "Adding theme toggle to the top bar",
      "Polishing Devices page dark styles (table, filters, pills)",
      "Waiting for Vite hot-reload in the preview…",
    ];
    options.onStep?.(steps[0]!);
    await mkdir(join(srcDir, "components"), { recursive: true });
    if (!existsSync(join(srcDir, "theme.ts"))) {
      await writeFile(join(srcDir, "theme.ts"), THEME_TS, "utf8");
    }
    await writeFile(join(srcDir, "components", "ThemeToggle.tsx"), THEME_TOGGLE, "utf8");
    await writeFile(join(srcDir, "App.tsx"), APP_WITH_TOGGLE, "utf8");
    options.onStep?.(steps[1]!);
    const stylesPath = join(srcDir, "styles.css");
    const existing = await readFile(stylesPath, "utf8");
    if (!existing.includes("devices-dark-polish")) {
      await appendFile(stylesPath, DEVICES_DARK_CSS, "utf8");
    }
    options.onStep?.(steps[2]!);
    return {
      applied: true,
      summary:
        "Devices page dark styles fixed + light/dark toggle in the top bar.",
      steps,
    };
  }

  const needsDrawer = wantsDeviceDrawerFix(options.artifacts);
  const needsLocations = wantsLocationsBadgeFix(options.artifacts);

  if (needsDrawer || needsLocations) {
    const steps: string[] = [];
    const summaryParts: string[] = [];

    await mkdir(join(srcDir, "pages"), { recursive: true });

    if (needsDrawer) {
      steps.push("Updating src/pages/DevicesPage.tsx — drawer + URL filters");
      options.onStep?.(steps[steps.length - 1]!);
      await writeFile(join(srcDir, "pages", "DevicesPage.tsx"), DEVICES_PAGE, "utf8");
      summaryParts.push(
        "View Details opens a drawer; filters stay in the URL",
      );
    }

    if (needsLocations) {
      steps.push("Updating HomePage — Locations card like Devices and Settings");
      options.onStep?.(steps[steps.length - 1]!);
      await writeFile(join(srcDir, "pages", "HomePage.tsx"), HOME_PAGE_WITH_LOCATIONS, "utf8");
      steps.push("Adding LocationsPage and /locations route");
      options.onStep?.(steps[steps.length - 1]!);
      await writeFile(join(srcDir, "pages", "LocationsPage.tsx"), LOCATIONS_PAGE, "utf8");
      const stylesPath = join(srcDir, "styles.css");
      const existing = await readFile(stylesPath, "utf8");
      if (!existing.includes("location-list")) {
        await appendFile(
          stylesPath,
          `
/* locations-page */
.location-list {
  margin: 16px 0 0;
  padding-left: 1.2rem;
  color: #5a6478;
}
.location-list li {
  margin: 8px 0;
}
`,
          "utf8",
        );
      }
      summaryParts.push("Locations in top nav and /locations page");
    }

    steps.push("Updating src/App.tsx — merged navigation (keeps prior demo fixes)");
    options.onStep?.(steps[steps.length - 1]!);
    await writeFile(join(srcDir, "App.tsx"), APP_CANONICAL, "utf8");

    steps.push("Waiting for Vite hot-reload in the preview…");
    options.onStep?.(steps[steps.length - 1]!);

    return {
      applied: true,
      summary: summaryParts.join("; ") + ".",
      steps,
    };
  }

  if (wantsDarkModeFix(options.artifacts)) {
    const steps = [
      "Adding src/theme.ts — theme helper",
      "Wiring Settings color mode to apply dark palette",
      "Updating styles.css with dark theme rules",
      "Waiting for Vite hot-reload in the preview…",
    ];
    options.onStep?.(steps[0]!);
    await writeFile(join(srcDir, "theme.ts"), THEME_TS, "utf8");
    options.onStep?.(steps[1]!);
    await mkdir(join(srcDir, "pages"), { recursive: true });
    await writeFile(join(srcDir, "pages", "SettingsPage.tsx"), SETTINGS_PAGE_DARK, "utf8");
    await writeFile(join(srcDir, "main.tsx"), MAIN_TSX_DARK, "utf8");
    options.onStep?.(steps[2]!);
    const stylesPath = join(srcDir, "styles.css");
    const existing = await readFile(stylesPath, "utf8");
    if (!existing.includes("[data-theme=\"dark\"]")) {
      await appendFile(stylesPath, DARK_CSS, "utf8");
    }
    options.onStep?.(steps[3]!);
    return {
      applied: true,
      summary: "Dark mode works — use Settings → Color mode → Dark → Save.",
      steps,
    };
  }

  const changeRequest = options.artifacts.find(
    (a): a is import("@oryntra/core").ChangeRequest => a.kind === "change_request",
  );
  const title = changeRequest?.title ?? "Approved change";

  return {
    applied: false,
    summary: `No automatic fix matched: ${title}`,
    steps: [
      `Reviewed: ${title}`,
      "No built-in demo fix matched this request.",
      "Open Cursor and check .oryntra/review-history.md to continue.",
    ],
  };
}
