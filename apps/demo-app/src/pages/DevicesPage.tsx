import { useMemo, useState } from "react";
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
        aria-label={`${device.name} details`}
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
                <span className={`pill pill-${device.status}`}>
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
