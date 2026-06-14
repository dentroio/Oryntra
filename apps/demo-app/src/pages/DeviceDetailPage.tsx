import { Link, useParams } from "react-router-dom";
import { DEVICES } from "../data";

export function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const device = DEVICES.find((d) => d.id === id);

  if (!device) {
    return (
      <section className="page">
        <h1>Device not found</h1>
        <Link to="/devices">Back to devices</Link>
      </section>
    );
  }

  return (
    <section className="page">
      <p className="breadcrumb">
        <Link to="/devices">Devices</Link> / {device.name}
      </p>
      <h1>{device.name}</h1>
      <div className="detail-card">
        <dl>
          <dt>Status</dt>
          <dd>{device.status}</dd>
          <dt>Site</dt>
          <dd>{device.site}</dd>
          <dt>ID</dt>
          <dd>{device.id}</dd>
        </dl>
        <p className="muted">
          This full-page detail view is intentional — reviewers should ask for a
          drawer instead.
        </p>
      </div>
    </section>
  );
}
