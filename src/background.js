/**
 * Oryntra service worker — handles tab screenshot capture.
 * Content scripts cannot call chrome.tabs.captureVisibleTab() directly
 * (requires the background context), so the content script sends a message here.
 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CAPTURE_TAB" && sender.tab?.id) {
    chrome.tabs.captureVisibleTab(
      sender.tab.windowId,
      { format: "png", quality: 95 },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ dataUrl });
        }
      }
    );
    return true; // keep message channel open for async response
  }
});
