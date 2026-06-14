export function sanitizeCursorAgentError(error: unknown): string {
  const err = error as { stderr?: Buffer | string; message?: string };
  const stderr =
    typeof err.stderr === "string"
      ? err.stderr
      : err.stderr?.toString("utf8") ?? "";
  const message = err.message ?? "";
  const combined = `${stderr}\n${message}`;

  if (/Authentication required|cursor agent login|CURSOR_API_KEY/i.test(combined)) {
    return "Cursor agent is not logged in. Run `cursor agent login` in a terminal, then try again.";
  }

  const errorLine = combined
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("Error:"));
  if (errorLine) {
    return errorLine.slice(0, 240);
  }

  if (combined.includes("Oryntra Review Studio") || combined.length > 300) {
    return "Cursor agent CLI failed. Check `cursor agent login` and retry.";
  }

  const last = combined
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  return (last ?? "Cursor agent failed").slice(0, 240);
}
