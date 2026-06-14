import { Link } from "react-router-dom";

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
