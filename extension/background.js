// MV3 service worker: goes idle after ~30s, so nothing here relies on module-level
// state surviving between events. Conversation history lives in chrome.storage.local,
// keyed by page URL (not tab ID) so it survives tab close/reopen and full browser
// restarts — tab IDs are reassigned on restart and can't serve as a durable key.

const DEFAULT_BACKEND_URL = "http://localhost:8000";
const DEFAULT_MODEL = "llama-3.1-8b-instant";
const MAX_HISTORY_TURNS = 6;

const HISTORY_PREFIX = "history_";
const HISTORY_INDEX_KEY = "historyIndex"; // array of URLs, most-recently-used first
const MAX_STORED_PAGES = 50; // cap so local storage doesn't grow unbounded over time

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.sync.get("backendUrl");
  return backendUrl || DEFAULT_BACKEND_URL;
}

async function getModel() {
  const { model } = await chrome.storage.sync.get("model");
  return model || DEFAULT_MODEL;
}

async function getPageHistory(url) {
  const key = HISTORY_PREFIX + normalizeUrl(url);
  const stored = await chrome.storage.local.get(key);
  return stored[key] || [];
}

// Moves `url` to the front of the LRU index and evicts the oldest entries
// beyond MAX_STORED_PAGES so history for pages you rarely revisit doesn't
// accumulate forever.
async function touchHistoryIndex(url) {
  const normalized = normalizeUrl(url);
  const { [HISTORY_INDEX_KEY]: index = [] } = await chrome.storage.local.get(HISTORY_INDEX_KEY);
  const next = [normalized, ...index.filter((u) => u !== normalized)];
  const kept = next.slice(0, MAX_STORED_PAGES);
  const evicted = next.slice(MAX_STORED_PAGES);
  if (evicted.length) {
    await chrome.storage.local.remove(evicted.map((u) => HISTORY_PREFIX + u));
  }
  await chrome.storage.local.set({ [HISTORY_INDEX_KEY]: kept });
}

async function appendPageHistory(url, question, answer) {
  const normalized = normalizeUrl(url);
  const key = HISTORY_PREFIX + normalized;
  const history = await getPageHistory(url);
  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: answer });
  const trimmed = history.slice(-MAX_HISTORY_TURNS * 2);
  await chrome.storage.local.set({ [key]: trimmed });
  await touchHistoryIndex(normalized);

  // Sync to PostgreSQL backend if authenticated
  const { authToken } = await chrome.storage.local.get("authToken");
  if (authToken) {
    const backendUrl = await getBackendUrl();
    let title = normalized;
    try {
      // Find tab matching this URL to retrieve its title
      const tabs = await chrome.tabs.query({});
      const match = tabs.find(t => t.url && normalizeUrl(t.url) === normalized);
      if (match && match.title) {
        title = match.title;
      }
      
      await fetch(`${backendUrl}/chat/history`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`
        },
        body: JSON.stringify({
          url: url,
          title: title,
          messages: trimmed
        })
      });
    } catch (err) {
      console.error("Failed to sync chat history to server:", err);
    }
  }
}

// Only ordinary http(s) pages can be scripted — chrome://, other extensions'
// chrome-extension://<their-id>/... pages (e.g. a third-party PDF viewer
// rendering the active tab), the Chrome Web Store, and file:// without the
// "Allow access to file URLs" toggle all reject executeScript/sendMessage.
function isScriptableUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

async function extractPageContent(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const title = tab?.title || "";
  const url = tab?.url || "";

  if (!isScriptableUrl(url)) {
    return { title, url, content: "", truncated: false, unreadable: true };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_TEXT" });
  } catch (err) {
    // Tab navigated away, is otherwise protected, or belongs to another
    // extension mid-flight — degrade gracefully instead of failing the
    // whole request (PDF/GitHub Mode already supply their own context
    // separately via extraContext).
    return { title, url, content: "", truncated: false, unreadable: true };
  }
}

async function streamChat(port, tabId, question, extraContext) {
  // Page extraction must resolve first since the history lookup below is
  // keyed by the page's URL, which we only learn from this call.
  const [page, backendUrl, model] = await Promise.all([
    extractPageContent(tabId),
    getBackendUrl(),
    getModel(),
  ]);
  const history = await getPageHistory(page.url);

  const systemPrompt =
    `You are a helpful assistant answering questions about a webpage.\n` +
    `Page title: ${page.title}\nPage URL: ${page.url}\n\n` +
    (page.unreadable
      ? `[Page content could not be read directly — this is likely a PDF viewer, ` +
        `a browser-internal page, or another extension's page. Rely on any ` +
        `additional context supplied below instead.]`
      : `Page content:\n${page.content}${page.truncated ? "\n[...page content truncated...]" : ""}`) +
    // GitHub Mode actions (see GITHUB_MODE_ACTION below) attach richer,
    // API-fetched repo data here — the plain page text above rarely covers
    // things like the full file tree or a manifest file's contents.
    (extraContext
      ? `\n\nAdditional context for this request:\n${extraContext}`
      : "");

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: question },
  ];

  const { authToken } = await chrome.storage.local.get("authToken");
  const headers = { "Content-Type": "application/json" };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${backendUrl}/chat`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({ provider: "groq", model, messages, stream: true }),
  });

  if (!response.ok || !response.body) {
    let errMsg = `Backend error ${response.status}`;
    try {
      const errJson = await response.json();
      errMsg = errJson.detail || errJson.error || JSON.stringify(errJson);
    } catch {
      const detail = await response.text().catch(() => "");
      if (detail) errMsg = detail;
    }
    throw new Error(errMsg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullAnswer = "";
  let buffer = "";

  try {
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
          if (parsed.error) {
            port.postMessage({ type: "ERROR", message: parsed.error });
            return;
          }
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
  } catch (streamErr) {
    // The connection dropped mid-stream (Chrome surfaces this as a distinct
    // "network error", separate from a pre-connection "Failed to fetch") —
    // typically the backend or upstream LLM provider timing out or erroring
    // partway through a large generation (PDF-mode prompts are the biggest
    // we send). If we'd already streamed some content, salvage it instead
    // of discarding a partial answer the user already saw appear.
    if (!fullAnswer) throw streamErr;
    const note = "\n\n_(Response was cut off — the connection was interrupted mid-stream.)_";
    fullAnswer += note;
    port.postMessage({ type: "CHUNK", delta: note });
  }

  await appendPageHistory(page.url, question, fullAnswer);
  port.postMessage({ type: "DONE" });
}

async function streamAssistant(port, systemPrompt, promptText) {
  const [backendUrl, model] = await Promise.all([
    getBackendUrl(),
    getModel(),
  ]);

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: promptText },
  ];

  const { authToken } = await chrome.storage.local.get("authToken");
  const headers = { "Content-Type": "application/json" };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${backendUrl}/chat`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({ provider: "groq", model, messages, stream: true }),
  });

  if (!response.ok || !response.body) {
    let errMsg = `Backend error ${response.status}`;
    try {
      const errJson = await response.json();
      errMsg = errJson.detail || errJson.error || JSON.stringify(errJson);
    } catch {
      const detail = await response.text().catch(() => "");
      if (detail) errMsg = detail;
    }
    throw new Error(errMsg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
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
        if (parsed.error) {
          port.postMessage({ type: "ERROR", message: parsed.error });
          return;
        }
        const delta = parsed.choices?.[0]?.delta?.content || "";
        if (delta) {
          port.postMessage({ type: "CHUNK", delta });
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }

  port.postMessage({ type: "DONE" });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "chat") {
    port.onMessage.addListener((message) => {
      if (message?.type !== "ASK") return;
      streamChat(port, message.tabId, message.question, message.context).catch((err) => {
        port.postMessage({ type: "ERROR", message: err.message || String(err) });
      });
    });
  } else if (port.name === "assistant") {
    port.onMessage.addListener((message) => {
      if (message?.type !== "ASK_ASSISTANT") return;
      streamAssistant(port, message.systemPrompt, message.promptText).catch((err) => {
        port.postMessage({ type: "ERROR", message: err.message || String(err) });
      });
    });
  }
});

// ---------------------------------------------------------------------
// GitHub Mode: github.js (a persistent content script, unlike content.js)
// renders a floating action rail on github.com repo pages. Each button
// click lands here as a GITHUB_MODE_ACTION message; we fetch whatever
// GitHub API data that action needs, turn it into a canned question +
// context blob, and hand it to the chat UI via the same one-shot
// chrome.storage.session pending-payload pattern used for the context-menu
// actions below.
// ---------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";
const GITHUB_CONTEXT_MAX_CHARS = 9000;

const MANIFEST_FILENAMES = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "composer.json",
];

function truncateText(text, max = GITHUB_CONTEXT_MAX_CHARS) {
  if (!text) return { text: "", truncated: false };
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

async function githubApiFetch(path) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? "GitHub API rate limit reached — try again in a bit."
        : `GitHub API error (${res.status}) for ${path}`
    );
  }
  return res.json();
}

async function fetchDefaultBranch(owner, repo) {
  const info = await githubApiFetch(`/repos/${owner}/${repo}`);
  return info.default_branch;
}

async function fetchRepoTree(owner, repo, ref) {
  const branch = ref || (await fetchDefaultBranch(owner, repo));
  const data = await githubApiFetch(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );
  const paths = (data.tree || [])
    .filter((entry) => entry.type === "blob" || entry.type === "tree")
    .map((entry) => (entry.type === "tree" ? `${entry.path}/` : entry.path));
  return { paths, truncatedByApi: !!data.truncated, branch };
}

async function fetchRawFile(owner, repo, ref, path) {
  const res = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`
  );
  return res.ok ? res.text() : null;
}

async function fetchReadme(owner, repo, ref) {
  try {
    const meta = await githubApiFetch(
      `/repos/${owner}/${repo}/readme${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`
    );
    if (!meta.download_url) return null;
    const res = await fetch(meta.download_url);
    return res.ok ? res.text() : null;
  } catch {
    return null; // no README, or the API call failed — proceed without it
  }
}

function findManifestPaths(treePaths) {
  return treePaths
    .filter((p) => MANIFEST_FILENAMES.includes(p.split("/").pop()))
    .sort((a, b) => a.split("/").length - b.split("/").length); // shallowest first
}

async function fetchIssue(owner, repo, number) {
  const issue = await githubApiFetch(`/repos/${owner}/${repo}/issues/${number}`);
  let comments = [];
  try {
    comments = await githubApiFetch(
      `/repos/${owner}/${repo}/issues/${number}/comments?per_page=10`
    );
  } catch {
    // comments are a nice-to-have; the issue body alone is still useful
  }
  return { issue, comments };
}

async function buildGithubAction({ action, owner, repo, ref, path, issueNumber, selection }) {
  switch (action) {
    case "architecture": {
      const [{ paths }, readme] = await Promise.all([
        fetchRepoTree(owner, repo, ref),
        fetchReadme(owner, repo, ref),
      ]);
      const manifestPaths = findManifestPaths(paths).slice(0, 6);
      const parts = [
        `Repository: ${owner}/${repo}`,
        `Folder/file tree:\n${truncateText(paths.join("\n"), 4000).text}`,
        manifestPaths.length ? `Key manifest files found: ${manifestPaths.join(", ")}` : "",
        readme ? `README:\n${truncateText(readme, 4000).text}` : "",
      ].filter(Boolean);
      return {
        question:
          "Based on the repository structure and README below, explain the overall " +
          "architecture of this project — the major components/modules, how they " +
          "relate, the tech stack, and the general data/request flow if apparent.",
        context: parts.join("\n\n"),
      };
    }

    case "folder-structure": {
      const { paths, truncatedByApi } = await fetchRepoTree(owner, repo, ref);
      const { text, truncated } = truncateText(paths.join("\n"));
      return {
        question:
          "Explain the folder/directory structure of this repository below — what " +
          "each top-level directory is for and how the project is organized.",
        context:
          `Repository: ${owner}/${repo}\n\nFile tree:\n${text}` +
          (truncated || truncatedByApi ? "\n[...tree truncated...]" : ""),
      };
    }

    case "installation": {
      const readme = await fetchReadme(owner, repo, ref);
      const { text, truncated } = truncateText(readme || "");
      return {
        question:
          "Based on the README below, write clear step-by-step installation " +
          "instructions for this project. If the README doesn't cover installation, say so.",
        context:
          `Repository: ${owner}/${repo}\n\nREADME:\n${text || "(no README found)"}` +
          (truncated ? "\n[...truncated...]" : ""),
      };
    }

    case "dependencies": {
      const { paths, branch } = await fetchRepoTree(owner, repo, ref);
      const manifestPaths = findManifestPaths(paths).slice(0, 5);
      const files = await Promise.all(
        manifestPaths.map(async (p) => ({
          path: p,
          content: await fetchRawFile(owner, repo, ref || branch, p),
        }))
      );
      const fileParts = files
        .filter((f) => f.content)
        .map((f) => `--- ${f.path} ---\n${truncateText(f.content, 3000).text}`);
      return {
        question:
          "List and briefly explain the key dependencies of this project based on the " +
          "manifest files below, including what each dependency is likely used for.",
        context: fileParts.length
          ? `Repository: ${owner}/${repo}\n\n${fileParts.join("\n\n")}`
          : `Repository: ${owner}/${repo}\n\nNo recognizable dependency manifest files ` +
            `(package.json, requirements.txt, etc.) were found.`,
      };
    }

    case "explain-bug": {
      const { issue, comments } = await fetchIssue(owner, repo, issueNumber);
      const commentsText = comments
        .slice(0, 8)
        .map((c) => `${c.user?.login || "someone"}: ${c.body}`)
        .join("\n\n");
      return {
        question:
          "Explain the bug described in this GitHub issue below: what's going wrong, " +
          "the likely root cause, and a suggested fix if you can infer one from the discussion.",
        context: truncateText(
          `Issue #${issueNumber}: ${issue.title}\n\n${issue.body || ""}` +
            (commentsText ? `\n\nDiscussion:\n${commentsText}` : "")
        ).text,
      };
    }

    case "generate-readme": {
      const [{ paths, branch }, readme, repoInfo] = await Promise.all([
        fetchRepoTree(owner, repo, ref),
        fetchReadme(owner, repo, ref),
        githubApiFetch(`/repos/${owner}/${repo}`).catch(() => null),
      ]);
      const manifestPaths = findManifestPaths(paths).slice(0, 6);
      const manifestFiles = await Promise.all(
        manifestPaths.map(async (p) => ({
          path: p,
          content: await fetchRawFile(owner, repo, ref || branch, p),
        }))
      );
      const parts = [
        `Repository: ${owner}/${repo}`,
        repoInfo?.description ? `Description: ${repoInfo.description}` : "",
        `File tree:\n${truncateText(paths.join("\n"), 3000).text}`,
        ...manifestFiles
          .filter((f) => f.content)
          .map((f) => `--- ${f.path} ---\n${truncateText(f.content, 1500).text}`),
        readme ? `Existing README:\n${truncateText(readme, 3000).text}` : "",
      ].filter(Boolean);
      return {
        question: readme
          ? "Rewrite/improve the README.md for this repository based on the information " +
            "below — keep anything accurate, fix or expand anything unclear, and follow " +
            "standard README conventions (title, description, installation, usage, etc.)."
          : "Generate a complete, well-structured README.md for this repository based on " +
            "the information below (title, description, installation, usage, etc.).",
        context: parts.join("\n\n"),
      };
    }

    case "generate-docs": {
      if (path) {
        const branch = ref || (await fetchDefaultBranch(owner, repo));
        const content = await fetchRawFile(owner, repo, branch, path);
        const { text, truncated } = truncateText(content || "");
        return {
          question:
            `Generate documentation for the file "${path}" below — a summary of its ` +
            `purpose, and doc comments/docstrings for its main functions/exports.`,
          context: `File: ${path}\n\n${text}${truncated ? "\n[...truncated...]" : ""}`,
        };
      }
      const [{ paths }, readme] = await Promise.all([
        fetchRepoTree(owner, repo, ref),
        fetchReadme(owner, repo, ref),
      ]);
      return {
        question:
          "Based on the repository structure and README below, propose a documentation " +
          "outline for this project (what doc pages/sections it should have and what each should cover).",
        context:
          `Repository: ${owner}/${repo}\n\nFile tree:\n${truncateText(paths.join("\n"), 4000).text}` +
          (readme ? `\n\nREADME:\n${truncateText(readme, 3000).text}` : ""),
      };
    }

    case "explain-function": {
      const branch = ref || (await fetchDefaultBranch(owner, repo));
      const content = selection || (path ? await fetchRawFile(owner, repo, branch, path) : null);
      const { text, truncated } = truncateText(content || "");
      return {
        question: selection
          ? "Explain what the following selected code does — its purpose, parameters, " +
            "return value, and any side effects."
          : `Explain the main functions/exports in the file "${path}" below and what each does.`,
        context: `${path ? `File: ${path}\n\n` : ""}${text}${truncated ? "\n[...truncated...]" : ""}`,
      };
    }

    default:
      throw new Error(`Unknown GitHub Mode action: ${action}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GITHUB_MODE_ACTION") {
    const tabId = sender.tab?.id || message.tabId;
    if (!tabId) {
      sendResponse({ ok: false, error: "No active tab detected." });
      return;
    }

    (async () => {
      try {
        const { question, context } = await buildGithubAction(message);
        if (sender.tab?.id) {
          await chrome.storage.session.set({
            [`pendingGithubAction_${tabId}`]: { question, context },
          });
          await surfaceChatUi(tabId);
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: true, question, context });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();

    return true; // keep the message channel open for the async work above
  }

  if (message?.type === "FETCH_PDF") {
    fetch(message.url, { credentials: "include" })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
        }
        return res.arrayBuffer();
      })
      .then((buffer) => {
        // Convert ArrayBuffer to base64 string safely
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const len = bytes.byteLength;
        const chunkSize = 8192;
        for (let i = 0; i < len; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        const base64 = btoa(binary);
        sendResponse({ ok: true, data: base64 });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message || String(err) });
      });
    return true; // keep the message channel open for the async fetch
  }
});

// Context-menu actions ("Ask about selection", "Translate to Bangla"):
// persist a one-shot payload first (so it survives regardless of whether a
// UI surface actually manages to open — MV3 popups can't have state
// injected into them programmatically, and chrome.action.openPopup() is
// unreliable when called from a non-toolbar gesture like a context-menu
// click), then best-effort try to surface it, with a toolbar badge as the
// guaranteed-visible fallback. These payloads are transient hand-offs (not
// conversation memory), so chrome.storage.session — scoped to the current
// tab ID for the current browser session — is the right store for them,
// unlike the URL-keyed, chrome.storage.local conversation history above.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "askAboutSelection",
      title: 'Ask AI about "%s"',
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "translateToBangla",
      title: 'Translate "%s" to Bangla',
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "explainSelectionAssistant",
      title: '✨ Explain Selection',
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "translateSelectionAssistant",
      title: '🌐 Translate Selection',
      contexts: ["selection"],
    });
  });
});

async function surfaceChatUi(tabId) {
  try {
    await chrome.sidePanel.open({ tabId });
  } catch {
    try {
      await chrome.action.openPopup();
    } catch {
      // Neither surface could be opened programmatically; the badge
      // below is the fallback the user can act on manually.
    }
  }
  await chrome.action.setBadgeText({ tabId, text: "1" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.selectionText || !tab?.id) return;
  const selection = info.selectionText.trim();

  if (info.menuItemId === "askAboutSelection") {
    const prefill = `Regarding the following selected text:\n"${selection}"\n\nMy question: `;
    await chrome.storage.session.set({ [`pendingSelection_${tab.id}`]: prefill });
    await surfaceChatUi(tab.id);
  } else if (info.menuItemId === "translateToBangla") {
    const question =
      `Translate the following text to Bangla (Bengali). ` +
      `Respond with only the Bangla translation, nothing else:\n\n"${selection}"`;
    await chrome.storage.session.set({ [`pendingTranslation_${tab.id}`]: question });
    await surfaceChatUi(tab.id);
  } else if (info.menuItemId === "explainSelectionAssistant" || info.menuItemId === "translateSelectionAssistant") {
    const action = info.menuItemId === "explainSelectionAssistant" ? "explain" : "translate";
    chrome.tabs.sendMessage(tab.id, { type: "CONTEXT_MENU_ACTION", action }, () => {
      if (chrome.runtime.lastError) {
        console.warn("Could not communicate with content script. Tab may not support content scripts.", chrome.runtime.lastError);
      }
    });
  }
});
