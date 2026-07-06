// Injected on demand into the active tab to extract readable page text.
// Runs only when the user opens the popup (activeTab permission), not on every page load.

// This file is (re-)injected via chrome.scripting.executeScript on every
// PDF/Smart-Search/chat action, so guard against registering the onMessage
// listener more than once per tab.
if (!window.__chatWithThisPageContentScriptLoaded) {
  window.__chatWithThisPageContentScriptLoaded = true;

  function extractPageText() {
    const title = document.title || "";
    const url = location.href;

    const clone = document.body.cloneNode(true);
    clone.querySelectorAll(
      "script, style, noscript, svg, nav, footer, header, iframe, template"
    ).forEach((el) => el.remove());

    const rawText = clone.innerText || "";
    const text = rawText.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

    const MAX_CHARS = 12000;
    const truncated = text.length > MAX_CHARS;
    const content = truncated ? text.slice(0, MAX_CHARS) : text;

    return { title, url, content, truncated };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "EXTRACT_PAGE_TEXT") {
      sendResponse(extractPageText());
      return true;
    }
    return true;
  });
}
