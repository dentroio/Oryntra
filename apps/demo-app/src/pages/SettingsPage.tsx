import { useEffect, useState } from "react";
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
