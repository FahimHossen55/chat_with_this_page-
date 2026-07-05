const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("askForm");
const questionEl = document.getElementById("question");
const sendBtn = document.getElementById("sendBtn");
document.getElementById("optionsBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

let activeTabId = null;
let port = null;
let currentAssistantEl = null;

function addMessage(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

async function loadHistory(tabId) {
  const key = `history_${tabId}`;
  const stored = await chrome.storage.session.get(key);
  const history = stored[key] || [];
  for (const turn of history) {
    addMessage(turn.role, turn.content);
  }
}

function setSending(isSending) {
  sendBtn.disabled = isSending;
  questionEl.disabled = isSending;
}

function connectPort() {
  port = chrome.runtime.connect({ name: "chat" });
  port.onMessage.addListener((message) => {
    if (message.type === "CHUNK") {
      if (!currentAssistantEl) {
        currentAssistantEl = addMessage("assistant", "");
      }
      currentAssistantEl.textContent += message.delta;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else if (message.type === "DONE") {
      currentAssistantEl = null;
      setSending(false);
    } else if (message.type === "ERROR") {
      addMessage("error", message.message);
      currentAssistantEl = null;
      setSending(false);
    }
  });
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const question = questionEl.value.trim();
  if (!question || !activeTabId) return;

  addMessage("user", question);
  questionEl.value = "";
  setSending(true);

  if (!port) connectPort();
  port.postMessage({ type: "ASK", tabId: activeTabId, question });
});

questionEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

(async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  if (activeTabId) await loadHistory(activeTabId);
  connectPort();
})();
