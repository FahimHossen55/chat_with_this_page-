// MV3 service worker: goes idle after ~30s, so nothing here relies on module-level
// state surviving between events. Per-tab history lives in chrome.storage.session.

const DEFAULT_BACKEND_URL = "http://localhost:8000";
const DEFAULT_MODEL = "llama-3.1-8b-instant";
const MAX_HISTORY_TURNS = 6;

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.sync.get("backendUrl");
  return backendUrl || DEFAULT_BACKEND_URL;
}

async function getModel() {
  const { model } = await chrome.storage.sync.get("model");
  return model || DEFAULT_MODEL;
}

async function getTabHistory(tabId) {
  const key = `history_${tabId}`;
  const stored = await chrome.storage.session.get(key);
  return stored[key] || [];
}

async function appendTabHistory(tabId, question, answer) {
  const key = `history_${tabId}`;
  const history = await getTabHistory(tabId);
  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: answer });
  const trimmed = history.slice(-MAX_HISTORY_TURNS * 2);
  await chrome.storage.session.set({ [key]: trimmed });
}

async function extractPageContent(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  return chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_TEXT" });
}

async function streamChat(port, tabId, question) {
  const [page, history, backendUrl, model] = await Promise.all([
    extractPageContent(tabId),
    getTabHistory(tabId),
    getBackendUrl(),
    getModel(),
  ]);

  const systemPrompt =
    `You are a helpful assistant answering questions about a webpage.\n` +
    `Page title: ${page.title}\nPage URL: ${page.url}\n\n` +
    `Page content:\n${page.content}${page.truncated ? "\n[...page content truncated...]" : ""}`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: question },
  ];

  const response = await fetch(`${backendUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "groq", model, messages, stream: true }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Backend error ${response.status}: ${detail || response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullAnswer = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith("data:")) continue;
      const data = trimmedLine.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || "";
        if (delta) {
          fullAnswer += delta;
          port.postMessage({ type: "CHUNK", delta });
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }

  await appendTabHistory(tabId, question, fullAnswer);
  port.postMessage({ type: "DONE" });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "chat") return;

  port.onMessage.addListener((message) => {
    if (message?.type !== "ASK") return;
    streamChat(port, message.tabId, message.question).catch((err) => {
      port.postMessage({ type: "ERROR", message: err.message || String(err) });
    });
  });
});
