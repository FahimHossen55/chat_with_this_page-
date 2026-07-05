const messagesEl = document.getElementById("messages");
const emptyStateEl = document.getElementById("emptyState");
const formEl = document.getElementById("askForm");
const questionEl = document.getElementById("question");
const sendBtn = document.getElementById("sendBtn");
const charCountEl = document.getElementById("charCount");
const pageTitleEl = document.getElementById("pageTitle");
const modelBadgeTextEl = document.getElementById("modelBadgeText");

document.getElementById("optionsBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Must match background.js's scheme exactly — conversation history is
// keyed by (normalized) page URL in chrome.storage.local, not by tab ID,
// so it survives tab close/reopen and full browser restarts.
const HISTORY_PREFIX = "history_";

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

let activeTabId = null;
let activeTabUrl = null;
let port = null;
let currentAssistantEl = null;
let currentAssistantRaw = "";
let typingEl = null;
let lastQuestion = "";
// Tracks which tab an in-flight request belongs to, so that switching
// tabs mid-stream (side panel only — a popup is torn down on tab switch)
// doesn't paint one tab's streamed tokens into another tab's message list.
let streamingForTabId = null;

const MODEL_LABELS = {
  "llama-3.1-8b-instant": "Llama 3.1 8B",
  "llama-3.3-70b-versatile": "Llama 3.3 70B",
  "openai/gpt-oss-120b": "GPT-OSS 120B",
  "openai/gpt-oss-20b": "GPT-OSS 20B",
  "qwen/qwen3-32b": "Qwen3 32B",
};

function updateEmptyState() {
  const hasMessages = messagesEl.querySelector(".msg-row") !== null;
  emptyStateEl.style.display = hasMessages ? "none" : "flex";
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, text) {
  const row = document.createElement("div");
  row.className = `msg-row ${role}`;

  if (role !== "error") {
    const label = document.createElement("div");
    label.className = "msg-label";
    label.textContent = role === "user" ? "You" : "Assistant";
    row.appendChild(label);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg";
  if (role === "assistant") {
    bubble.innerHTML = renderMarkdownToHtml(text);
    bubble.dataset.raw = text;
  } else {
    bubble.textContent = text;
  }
  row.appendChild(bubble);

  if (role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(bubble.dataset.raw ?? bubble.textContent);
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
    });
    actions.appendChild(copyBtn);
    row.appendChild(actions);
  }

  if (role === "error") {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "retry-btn";
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", () => {
      row.remove();
      updateEmptyState();
      if (lastQuestion) sendQuestion(lastQuestion);
    });
    row.appendChild(retryBtn);
  }

  messagesEl.appendChild(row);
  updateEmptyState();
  scrollToBottom();
  return bubble;
}

function showTyping() {
  const row = document.createElement("div");
  row.className = "msg-row assistant";
  const bubble = document.createElement("div");
  bubble.className = "msg typing";
  bubble.innerHTML = "<span></span><span></span><span></span>";
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  scrollToBottom();
  return row;
}

async function getStoredHistory(url) {
  const key = HISTORY_PREFIX + normalizeUrl(url);
  const stored = await chrome.storage.local.get(key);
  return stored[key] || [];
}

async function loadHistory(url) {
  const history = await getStoredHistory(url);
  for (const turn of history) {
    addMessage(turn.role, turn.content);
  }
}

async function checkPendingSelection(tabId) {
  const key = `pendingSelection_${tabId}`;
  const stored = await chrome.storage.session.get(key);
  const prefill = stored[key];
  if (!prefill) return;

  questionEl.value = prefill;
  autoResize();
  charCountEl.textContent = `${questionEl.value.length}/${questionEl.maxLength}`;
  questionEl.focus();
  questionEl.setSelectionRange(questionEl.value.length, questionEl.value.length);

  await chrome.storage.session.remove(key);
  await chrome.action.setBadgeText({ tabId, text: "" });
}

async function checkPendingTranslation(tabId) {
  const key = `pendingTranslation_${tabId}`;
  const stored = await chrome.storage.session.get(key);
  const question = stored[key];
  if (!question) return;

  await chrome.storage.session.remove(key);
  await chrome.action.setBadgeText({ tabId, text: "" });
  sendQuestion(question);
}

// Shared by the initial load and every subsequent tab switch / in-tab
// navigation. A popup is torn down by Chrome on tab switch so this
// effectively only ever runs once for a popup instance, but a side panel
// instance stays alive across switches and navigations, so this must
// fully refresh all per-page UI state including which URL's history to show.
async function loadForTab(tabId, tabTitle, tabUrl) {
  activeTabId = tabId;
  activeTabUrl = tabUrl || null;
  pageTitleEl.textContent = tabTitle || "No page detected";
  messagesEl.querySelectorAll(".msg-row").forEach((row) => row.remove());
  updateEmptyState();
  if (tabId) {
    if (tabUrl) await loadHistory(tabUrl);
    await checkPendingSelection(tabId);
    await checkPendingTranslation(tabId);
  }
}

function setSending(isSending) {
  sendBtn.disabled = isSending;
  questionEl.disabled = isSending;
}

function connectPort() {
  port = chrome.runtime.connect({ name: "chat" });
  port.onMessage.addListener((message) => {
    const forActiveTab = streamingForTabId === activeTabId;

    if (message.type === "CHUNK") {
      if (!forActiveTab) return;
      if (typingEl) {
        typingEl.remove();
        typingEl = null;
      }
      if (!currentAssistantEl) {
        currentAssistantEl = addMessage("assistant", "");
      }
      currentAssistantRaw += message.delta;
      currentAssistantEl.innerHTML = renderMarkdownToHtml(currentAssistantRaw);
      currentAssistantEl.dataset.raw = currentAssistantRaw;
      scrollToBottom();
    } else if (message.type === "DONE") {
      if (forActiveTab && typingEl) {
        typingEl.remove();
      }
      typingEl = null;
      currentAssistantEl = null;
      currentAssistantRaw = "";
      streamingForTabId = null;
      setSending(false);
    } else if (message.type === "ERROR") {
      if (forActiveTab) {
        if (typingEl) typingEl.remove();
        addMessage("error", message.message);
      }
      typingEl = null;
      currentAssistantEl = null;
      currentAssistantRaw = "";
      streamingForTabId = null;
      setSending(false);
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
  });
}

function autoResize() {
  questionEl.style.height = "auto";
  questionEl.style.height = `${Math.min(questionEl.scrollHeight, 96)}px`;
}

function sendQuestion(question) {
  if (!question || !activeTabId) return;

  lastQuestion = question;
  streamingForTabId = activeTabId;
  addMessage("user", question);
  questionEl.value = "";
  autoResize();
  charCountEl.textContent = `0/${questionEl.maxLength}`;
  setSending(true);
  typingEl = showTyping();

  if (!port) connectPort();
  port.postMessage({ type: "ASK", tabId: activeTabId, question });
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  sendQuestion(questionEl.value.trim());
});

questionEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

questionEl.addEventListener("input", () => {
  autoResize();
  charCountEl.textContent = `${questionEl.value.length}/${questionEl.maxLength}`;
});

document.querySelectorAll(".suggestion").forEach((btn) => {
  btn.addEventListener("click", () => sendQuestion(btn.textContent));
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  if (!activeTabUrl) return;
  await chrome.storage.local.remove(HISTORY_PREFIX + normalizeUrl(activeTabUrl));
  messagesEl.querySelectorAll(".msg-row").forEach((row) => row.remove());
  updateEmptyState();
});

document.getElementById("modelBadge").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Absent in sidepanel.html, so this is a no-op there.
document.getElementById("sidePanelBtn")?.addEventListener("click", async () => {
  if (!chrome.sidePanel || !activeTabId) return;
  await chrome.sidePanel.open({ tabId: activeTabId });
  window.close();
});

async function refreshModelBadge() {
  const { model } = await chrome.storage.sync.get("model");
  const resolved = model || "llama-3.1-8b-instant";
  modelBadgeTextEl.textContent = MODEL_LABELS[resolved] || resolved;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.model) refreshModelBadge();
});

// Only meaningfully observed by a long-lived side panel instance — a
// popup is destroyed by Chrome before/at the point of a tab switch.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  await loadForTab(tabId, tab.title, tab.url);
});

// A side panel can stay open across in-tab navigation (e.g. clicking a
// link or the page redirecting) — a short-lived popup never had to account
// for this. A URL change means a different conversation thread entirely
// now that history is keyed by URL, so route it back through loadForTab().
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (tabId !== activeTabId) return;
  if (changeInfo.url) {
    const tab = await chrome.tabs.get(tabId);
    await loadForTab(tabId, tab.title, changeInfo.url);
  } else if (changeInfo.title) {
    pageTitleEl.textContent = changeInfo.title;
  }
});

(async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await refreshModelBadge();
  await loadForTab(tab?.id ?? null, tab?.title, tab?.url);
  connectPort();
})();
