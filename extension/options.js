const backendUrlEl = document.getElementById("backendUrl");
const providerEl = document.getElementById("provider");
const modelEl = document.getElementById("model");
const statusEl = document.getElementById("status");

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
