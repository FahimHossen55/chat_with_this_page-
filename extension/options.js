const backendUrlEl = document.getElementById("backendUrl");
const providerEl = document.getElementById("provider");
const modelEl = document.getElementById("model");
const statusEl = document.getElementById("status");
const testBtn = document.getElementById("testBtn");
const connectionStatusEl = document.getElementById("connectionStatus");

function setConnectionStatus(state, label) {
  connectionStatusEl.className = `status-pill ${state}`;
  connectionStatusEl.textContent = label;
}

async function load() {
  const { backendUrl, provider, model } = await chrome.storage.sync.get([
    "backendUrl",
    "provider",
    "model",
  ]);
  backendUrlEl.value = backendUrl || "http://localhost:8000";
  providerEl.value = provider || "groq";
  modelEl.value = model || "llama-3.1-8b-instant";
}

async function testConnection() {
  const url = backendUrlEl.value.trim().replace(/\/+$/, "");
  if (!url) return;

  testBtn.disabled = true;
  testBtn.textContent = "Testing…";
  setConnectionStatus("unknown", "Checking…");

  try {
    const res = await fetch(`${url}/health`, { method: "GET" });
    if (res.ok) {
      setConnectionStatus("ok", "Connected");
    } else {
      setConnectionStatus("fail", `HTTP ${res.status}`);
    }
  } catch {
    setConnectionStatus("fail", "Unreachable");
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = "Test";
  }
}

testBtn.addEventListener("click", testConnection);

document.getElementById("saveBtn").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    backendUrl: backendUrlEl.value.trim(),
    provider: providerEl.value,
    model: modelEl.value.trim(),
  });
  statusEl.textContent = "Saved.";
  setTimeout(() => (statusEl.textContent = ""), 1500);
});

load();
