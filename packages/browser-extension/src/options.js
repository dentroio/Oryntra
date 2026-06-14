const workspacePathEl = document.getElementById("workspacePath");
const appUrlEl = document.getElementById("appUrl");
const preferredIdeEl = document.getElementById("preferredIde");
const savedEl = document.getElementById("saved");

chrome.storage.local.get(
  ["workspacePath", "appUrl", "preferredIde"],
  (data) => {
    workspacePathEl.value = data.workspacePath ?? "";
    appUrlEl.value = data.appUrl ?? "http://localhost:3000";
    preferredIdeEl.value = data.preferredIde ?? "cursor";
  },
);

document.getElementById("save").addEventListener("click", () => {
  chrome.storage.local.set(
    {
      workspacePath: workspacePathEl.value.trim(),
      appUrl: appUrlEl.value.trim(),
      preferredIde: preferredIdeEl.value,
    },
    () => {
      savedEl.textContent = "Saved.";
    },
  );
});
