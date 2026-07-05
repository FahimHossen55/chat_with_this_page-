const messagesEl = document.getElementById("messages");
const emptyStateEl = document.getElementById("emptyState");
const formEl = document.getElementById("askForm");
const questionEl = document.getElementById("question");
const sendBtn = document.getElementById("sendBtn");
const charCountEl = document.getElementById("charCount");
const pageTitleEl = document.getElementById("pageTitle");
const modelBadgeTextEl = document.getElementById("modelBadgeText");
const scrollBottomBtn = document.getElementById("scrollBottomBtn");
const headerEl = document.querySelector("header");
const inputRowEl = document.querySelector(".input-row");

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
let lastContext = undefined;
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

// Within this many px of the bottom counts as "at the bottom" — lets a
// user scroll up to reread earlier messages without new chunks yanking
// them back down.
const NEAR_BOTTOM_THRESHOLD = 80;

function isNearBottom() {
  return (
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <
    NEAR_BOTTOM_THRESHOLD
  );
}

// Callers that are about to grow #messages' content should read
// isNearBottom() BEFORE mutating the DOM (growth alone can flip it to
// false even though the user hadn't scrolled) and pass the result here.
function scrollToBottom(shouldStick = true) {
  if (shouldStick) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  updateScrollBottomBtn();
}

function updateScrollBottomBtn() {
  scrollBottomBtn.classList.toggle("visible", !isNearBottom());
}

messagesEl.addEventListener("scroll", () => {
  updateScrollBottomBtn();
  headerEl.classList.toggle("scrolled", messagesEl.scrollTop > 2);
});

scrollBottomBtn.addEventListener("click", () => {
  messagesEl.scrollTop = messagesEl.scrollHeight;
  scrollBottomBtn.classList.remove("visible");
});

const COPY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.6"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function addMessage(role, text) {
  const shouldStick = role === "user" || isNearBottom();

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
    copyBtn.innerHTML = `${COPY_ICON}<span>Copy</span>`;
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(bubble.dataset.raw ?? bubble.textContent);
      copyBtn.innerHTML = `${CHECK_ICON}<span>Copied</span>`;
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.innerHTML = `${COPY_ICON}<span>Copy</span>`;
        copyBtn.classList.remove("copied");
      }, 1200);
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
      if (lastQuestion) sendQuestion(lastQuestion, lastContext);
    });
    row.appendChild(retryBtn);
  }

  messagesEl.appendChild(row);
  updateEmptyState();
  scrollToBottom(shouldStick);
  return bubble;
}

function showTyping() {
  const shouldStick = isNearBottom();
  const row = document.createElement("div");
  row.className = "msg-row assistant";
  const bubble = document.createElement("div");
  bubble.className = "msg typing";
  bubble.innerHTML = "<span></span><span></span><span></span>";
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  scrollToBottom(shouldStick);
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

// Set by background.js when a GitHub Mode rail button is clicked (see
// GITHUB_MODE_ACTION in background.js / github.js for the rail itself).
// Unlike pendingSelection, this carries a `context` blob of GitHub API
// data alongside the visible question — see sendQuestion's context param.
async function checkPendingGithubAction(tabId) {
  const key = `pendingGithubAction_${tabId}`;
  const stored = await chrome.storage.session.get(key);
  const pending = stored[key];
  if (!pending) return;

  await chrome.storage.session.remove(key);
  await chrome.action.setBadgeText({ tabId, text: "" });
  sendQuestion(pending.question, pending.context);
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
  headerEl.classList.remove("scrolled");
  updateScrollBottomBtn();
  if (tabId) {
    if (tabUrl) await loadHistory(tabUrl);
    await checkPendingSelection(tabId);
    await checkPendingTranslation(tabId);
    await checkPendingGithubAction(tabId);
  }
}

function setSending(isSending) {
  sendBtn.disabled = isSending;
  sendBtn.classList.toggle("loading", isSending);
  questionEl.disabled = isSending;
}

function connectPort() {
  port = chrome.runtime.connect({ name: "chat" });
  port.onMessage.addListener((message) => {
    const forActiveTab = streamingForTabId === activeTabId;

    if (message.type === "CHUNK") {
      if (!forActiveTab) return;
      const shouldStick = isNearBottom();
      if (typingEl) {
        typingEl.remove();
        typingEl = null;
      }
      if (!currentAssistantEl) {
        currentAssistantEl = addMessage("assistant", "");
      }
      currentAssistantEl.classList.add("streaming");
      currentAssistantRaw += message.delta;
      currentAssistantEl.innerHTML = renderMarkdownToHtml(currentAssistantRaw);
      currentAssistantEl.dataset.raw = currentAssistantRaw;
      scrollToBottom(shouldStick);
    } else if (message.type === "DONE") {
      if (forActiveTab && typingEl) {
        typingEl.remove();
      }
      currentAssistantEl?.classList.remove("streaming");
      typingEl = null;
      currentAssistantEl = null;
      currentAssistantRaw = "";
      streamingForTabId = null;
      setSending(false);
    } else if (message.type === "ERROR") {
      if (forActiveTab) {
        if (typingEl) typingEl.remove();
        currentAssistantEl?.classList.remove("streaming");
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

function sendQuestion(question, context) {
  if (!question || !activeTabId) return;

  lastQuestion = question;
  lastContext = context;
  streamingForTabId = activeTabId;
  addMessage("user", question);
  questionEl.value = "";
  autoResize();
  charCountEl.textContent = `0/${questionEl.maxLength}`;
  setSending(true);
  typingEl = showTyping();

  if (!port) connectPort();
  port.postMessage({ type: "ASK", tabId: activeTabId, question, context });
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
  const len = questionEl.value.length;
  charCountEl.textContent = `${len}/${questionEl.maxLength}`;
  charCountEl.classList.toggle("limit-near", len > questionEl.maxLength * 0.9);
});

questionEl.addEventListener("focus", () => inputRowEl.classList.add("focused"));
questionEl.addEventListener("blur", () => inputRowEl.classList.remove("focused"));

document.querySelectorAll(".suggestion").forEach((btn) => {
  btn.addEventListener("click", () => sendQuestion(btn.textContent));
});

document.getElementById("clearBtn").addEventListener("click", async (e) => {
  if (!activeTabUrl) return;
  const btn = e.currentTarget;
  btn.classList.add("spin");
  setTimeout(() => btn.classList.remove("spin"), 600);
  await chrome.storage.local.remove(HISTORY_PREFIX + normalizeUrl(activeTabUrl));
  messagesEl.querySelectorAll(".msg-row").forEach((row) => row.remove());
  updateEmptyState();
  updateScrollBottomBtn();
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
