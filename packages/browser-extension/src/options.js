const workspacePathEl = document.getElementById("workspacePath");
const appUrlEl = document.getElementById("appUrl");
const preferredIdeEl = document.getElementById("preferredIde");
const savedEl = document.getElementById("saved");

chrome.storage.local.get(
  ["workspacePath", "appUrl", "preferredIde"],
  (data) => {
    workspacePathEl.value = data.workspacePath ?? "";
    appUrlEl.value = data.appUrl ?? "";
    preferredIdeEl.value = data.preferredIde ?? "cursor";
  },
);

document.getElementById("save").addEventListener("click", () => {
  const workspacePath = workspacePathEl.value.trim();
  let appUrl = appUrlEl.value.trim();
  if (/^https?:\/\/(localhost|127\.0\.0\.1):3000\/?$/i.test(appUrl)) {
    appUrl = "";
    appUrlEl.value = "";
  }
  chrome.storage.local.set(
    {
      workspacePath,
      appUrl,
      preferredIde: preferredIdeEl.value,
    },
    () => {
      savedEl.textContent = "Saved. Click the Clarion tab, then Start review.";
    },
  );
});
