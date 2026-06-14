import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const devicesPage = `import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DEVICES } from "../data";

export function DevicesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const siteFilter = searchParams.get("site") ?? "all";
  const statusFilter = searchParams.get("status") ?? "all";
  const [showEmpty, setShowEmpty] = useState(false);

  const devices = useMemo(() => {
    if (showEmpty) return [];
    return DEVICES.filter((d) => {
      if (siteFilter !== "all" && d.site !== siteFilter) return false;
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      return true;
    });
  }, [siteFilter, statusFilter, showEmpty]);

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
                <Link
                  to={\`/devices/\${device.id}\`}
                  data-testid="device-details-button"
                >
                  View Details
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
`;

const appTsx = `import { NavLink, Route, Routes } from "react-router-dom";
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

await mkdir(join(root, "src", "pages"), { recursive: true });
await writeFile(join(root, "src", "pages", "DevicesPage.tsx"), devicesPage, "utf8");
await writeFile(join(root, "src", "App.tsx"), appTsx, "utf8");
console.log(
  "Demo app reset to intentional review bugs (full-page View Details, no Locations nav).",
);
console.log(
  "Use npm run collaborate:broken for a fresh broken demo — collaborate:restart keeps your approved fixes.",
);
