// ==================== AUTH SYSTEM START ====================
let authToken = null;
let userProfile = null;

// Auth DOM Elements
const authScreenEl = document.getElementById("authScreen");
const googleSignInBtnEl = document.getElementById("googleSignInBtn");
const userProfileBtnEl = document.getElementById("userProfileBtn");
const userAvatarEl = document.getElementById("userAvatar");
const userDropdownMenuEl = document.getElementById("userDropdownMenu");
const dropdownUserAvatarEl = document.getElementById("dropdownUserAvatar");
const dropdownUserNameEl = document.getElementById("dropdownUserName");
const dropdownUserEmailEl = document.getElementById("dropdownUserEmail");
const logoutBtnEl = document.getElementById("logoutBtn");

// Helper to get backend URL dynamically
async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.sync.get("backendUrl");
  return backendUrl || "http://localhost:8000";
}

// Intercept window.fetch to automatically inject JWT Bearer token
const originalFetch = window.fetch;
window.fetch = async function (resource, options = {}) {
  const urlStr = typeof resource === 'string' ? resource : (resource instanceof URL ? resource.toString() : resource.url);
  const resolvedBackend = await getBackendUrl();

  if (urlStr.startsWith(resolvedBackend)) {
    options.headers = options.headers || {};
    if (authToken) {
      if (options.headers instanceof Headers) {
        options.headers.set("Authorization", `Bearer ${authToken}`);
      } else if (Array.isArray(options.headers)) {
        const hasAuth = options.headers.some(h => h[0].toLowerCase() === 'authorization');
        if (!hasAuth) {
          options.headers.push(["Authorization", `Bearer ${authToken}`]);
        }
      } else {
        if (!options.headers["Authorization"] && !options.headers["authorization"]) {
          options.headers["Authorization"] = `Bearer ${authToken}`;
        }
      }
    }
  }

  const response = await originalFetch(resource, options);
  if (response.status === 401 && urlStr.startsWith(resolvedBackend)) {
    console.warn("Unauthorized request (401 from backend). Resetting session...");
    handleSignOut();
  }
  return response;
};

// UI State Toggles
function showAuthenticatedUI() {
  if (authScreenEl) authScreenEl.style.display = "none";
  if (userProfileBtnEl) userProfileBtnEl.style.display = "flex";
  if (userAvatarEl && userProfile) userAvatarEl.src = userProfile.picture || "logo.png";

  if (dropdownUserAvatarEl && userProfile) dropdownUserAvatarEl.src = userProfile.picture || "logo.png";
  if (dropdownUserNameEl && userProfile) dropdownUserNameEl.textContent = userProfile.name || "Research OS User";
  if (dropdownUserEmailEl && userProfile) dropdownUserEmailEl.textContent = userProfile.email || "";
}

function showUnauthenticatedUI() {
  if (authScreenEl) authScreenEl.style.display = "flex";
  if (userProfileBtnEl) userProfileBtnEl.style.display = "none";
  if (userDropdownMenuEl) userDropdownMenuEl.style.display = "none";
  authToken = null;
  userProfile = null;
}

// Google OAuth launch
async function handleSignIn() {
  try {
    if (googleSignInBtnEl) {
      googleSignInBtnEl.disabled = true;
      googleSignInBtnEl.style.opacity = "0.7";
      const textSpan = googleSignInBtnEl.querySelector("span");
      if (textSpan) textSpan.textContent = "Connecting...";
    }

    const resolvedBackend = await getBackendUrl();
    const redirectUri = chrome.identity.getRedirectURL();
    const loginUrl = `${resolvedBackend}/auth/login?redirect_uri=${encodeURIComponent(redirectUri)}`;

    chrome.identity.launchWebAuthFlow(
      { url: loginUrl, interactive: true },
      async (redirectUrl) => {
        if (googleSignInBtnEl) {
          googleSignInBtnEl.disabled = false;
          googleSignInBtnEl.style.opacity = "1";
          const textSpan = googleSignInBtnEl.querySelector("span");
          if (textSpan) textSpan.textContent = "Sign in with Google";
        }

        if (chrome.runtime.lastError || !redirectUrl) {
          console.error("Sign in failed:", chrome.runtime.lastError?.message);
          return;
        }

        const urlParams = new URLSearchParams(new URL(redirectUrl).search);
        const token = urlParams.get("token");
        const email = urlParams.get("email");
        const name = urlParams.get("name");
        const picture = urlParams.get("picture");

        if (token && email) {
          authToken = token;
          userProfile = { email, name, picture };
          await chrome.storage.local.set({ authToken, userProfile });
          showAuthenticatedUI();

          // Refresh literature trending page if function is available
          if (typeof loadTrendingPapers === "function") {
            loadTrendingPapers().catch(console.error);
          }
        } else {
          console.error("Authentication payload missing required fields:", redirectUrl);
        }
      }
    );
  } catch (err) {
    console.error("OAuth execution error:", err);
    if (googleSignInBtnEl) {
      googleSignInBtnEl.disabled = false;
      googleSignInBtnEl.style.opacity = "1";
      const textSpan = googleSignInBtnEl.querySelector("span");
      if (textSpan) textSpan.textContent = "Sign in with Google";
    }
  }
}

async function handleSignOut() {
  await chrome.storage.local.remove(["authToken", "userProfile"]);
  showUnauthenticatedUI();
}

// Setup Listeners
if (googleSignInBtnEl) {
  googleSignInBtnEl.addEventListener("click", handleSignIn);
}

if (logoutBtnEl) {
  logoutBtnEl.addEventListener("click", handleSignOut);
}

if (userProfileBtnEl) {
  userProfileBtnEl.addEventListener("click", (e) => {
    e.stopPropagation();
    if (userDropdownMenuEl) {
      if (userDropdownMenuEl.style.display === "none" || !userDropdownMenuEl.style.display) {
        userDropdownMenuEl.style.display = "flex";
      } else {
        userDropdownMenuEl.style.display = "none";
      }
    }
  });
}

document.addEventListener("click", (e) => {
  if (userDropdownMenuEl && userDropdownMenuEl.style.display === "flex") {
    if (!userDropdownMenuEl.contains(e.target) && !userProfileBtnEl.contains(e.target)) {
      userDropdownMenuEl.style.display = "none";
    }
  }
});

// Run auth check immediately
chrome.storage.local.get(["authToken", "userProfile"]).then((data) => {
  if (data.authToken && data.userProfile) {
    authToken = data.authToken;
    userProfile = data.userProfile;
    showAuthenticatedUI();
  } else {
    showUnauthenticatedUI();
  }
});
// ==================== AUTH SYSTEM END ====================

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

// GitHub Mode Elements
const githubModeBtnEl = document.getElementById("githubModeBtn");
const githubMenuEl = document.getElementById("githubMenu");
const closeGithubMenuBtnEl = document.getElementById("closeGithubMenuBtn");
const githubActionsGridEl = document.getElementById("githubActionsGrid");

// Features Dropdown Elements
const featuresDropdownBtn = document.getElementById("featuresDropdownBtn");
const featuresDropdownMenu = document.getElementById("featuresDropdownMenu");
const dropdownSmartSearch = document.getElementById("dropdownSmartSearch");
const dropdownLiterature = document.getElementById("dropdownLiterature");
const dropdownDatasets = document.getElementById("dropdownDatasets");
const dropdownPdf = document.getElementById("dropdownPdf");
const dropdownGithub = document.getElementById("dropdownGithub");

document.getElementById("optionsBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

const GITHUB_ACTIONS = [
  { id: "architecture", label: "Architecture", icon: "🏛️" },
  { id: "folder-structure", label: "Folder structure", icon: "📁" },
  { id: "installation", label: "Installation", icon: "⚙️" },
  { id: "dependencies", label: "Dependencies", icon: "📦" },
  { id: "explain-bug", label: "Explain bug", icon: "🐛", requires: "issue" },
  { id: "generate-readme", label: "Generate README", icon: "📝" },
  { id: "generate-docs", label: "Generate docs", icon: "📄" },
  { id: "explain-function", label: "Explain function", icon: "🔎", requires: "blob" },
];

const RESERVED_OWNERS = new Set([
  "marketplace", "notifications", "settings", "explore", "topics", "trending",
  "sponsors", "codespaces", "dashboard", "new", "orgs", "organizations",
  "about", "pricing", "features", "security", "resources", "customer-stories",
  "site", "apps", "collections", "events", "account", "login", "join",
  "logout", "search", "gist", "gists", "readme", "watching", "stars",
  "issues", "pulls", "notifications",
]);

function parseGitHubUrl(urlStr) {
  if (!urlStr) return null;
  try {
    const url = new URL(urlStr);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;

    const [owner, repo, ...rest] = segments;
    if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;

    const ctx = { owner, repo, ref: null, path: null, issueNumber: null, pageType: "repo" };

    if (rest[0] === "blob" && rest.length > 2) {
      ctx.pageType = "blob";
      ctx.ref = rest[1];
      ctx.path = rest.slice(2).join("/");
    } else if (rest[0] === "tree" && rest.length > 1) {
      ctx.ref = rest[1];
    } else if (rest[0] === "issues" && /^\d+$/.test(rest[1] || "")) {
      ctx.pageType = "issue";
      ctx.issueNumber = Number(rest[1]);
    }

    return ctx;
  } catch {
    return null;
  }
}

async function getTabSelection(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection()?.toString().trim() || "",
    });
    return result?.result || "";
  } catch {
    return "";
  }
}

function renderGithubMenuContent() {
  const ctx = parseGitHubUrl(activeTabUrl);
  if (!ctx) return;

  githubActionsGridEl.innerHTML = "";

  GITHUB_ACTIONS.forEach((action) => {
    const needsBlob = action.requires === "blob" && ctx.pageType !== "blob";
    const needsIssue = action.requires === "issue" && ctx.pageType !== "issue";
    const disabled = needsBlob || needsIssue;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "github-action-card";
    btn.disabled = disabled;
    if (disabled) {
      btn.title = needsBlob ? "Open a file to use this" : "Open an issue to use this";
    }

    btn.innerHTML = `<span class="action-icon">${action.icon}</span><span>${action.label}</span>`;
    
    btn.addEventListener("click", async () => {
      btn.classList.add("loading");
      btn.disabled = true;

      let selection = null;
      if (action.id === "explain-function") {
        selection = await getTabSelection(activeTabId);
      }

      chrome.runtime.sendMessage({
        type: "GITHUB_MODE_ACTION",
        action: action.id,
        owner: ctx.owner,
        repo: ctx.repo,
        ref: ctx.ref,
        path: ctx.path,
        issueNumber: ctx.issueNumber,
        selection: selection,
        tabId: activeTabId
      }, (response) => {
        btn.classList.remove("loading");
        btn.disabled = false;
        
        if (response && response.ok) {
          githubMenuEl.style.display = "none";
          sendQuestion(response.question, response.context);
        } else {
          const errorMsg = response?.error || "Error executing GitHub action.";
          alert(errorMsg);
        }
      });
    });

    githubActionsGridEl.appendChild(btn);
  });
}

githubModeBtnEl.addEventListener("click", () => {
  if (githubMenuEl.style.display === "none") {
    renderGithubMenuContent();
    githubMenuEl.style.display = "flex";
  } else {
    githubMenuEl.style.display = "none";
  }
});

closeGithubMenuBtnEl.addEventListener("click", () => {
  githubMenuEl.style.display = "none";
});

// ─── PDF / Smart Search Elements ──────────────────────────────────────────────
const pdfModeBtnEl     = document.getElementById("pdfModeBtn");
const pdfMenuEl        = document.getElementById("pdfMenu");
const closePdfBtn      = document.getElementById("closePdfMenuBtn");
const pdfActionsGridEl = document.getElementById("pdfActionsGrid");

const smartSearchBtnEl       = document.getElementById("smartSearchBtn");
const smartSearchPanelEl     = document.getElementById("smartSearchPanel");
const closeSmartSearchBtnEl  = document.getElementById("closeSmartSearchBtn");
const smartSearchInputEl     = document.getElementById("smartSearchInput");
const smartSearchSubmitBtnEl = document.getElementById("smartSearchSubmitBtn");
const smartSearchStatusEl    = document.getElementById("smartSearchStatus");

// ─── URL Detection Helpers ────────────────────────────────────────────────────
// Only ordinary http(s) pages can have scripts injected into them — Chrome
// rejects chrome.scripting.executeScript / chrome.tabs.sendMessage against
// chrome://, another extension's chrome-extension://<their-id>/... pages
// (e.g. a third-party PDF viewer rendering the current tab), the Chrome Web
// Store, and file:// without the "Allow access to file URLs" toggle, with
// "Cannot access a chrome-extension:// URL of different extension" or
// similar — so callers must check this before attempting injection.
function isScriptableTabUrl(urlStr) {
  return /^https?:\/\//i.test(urlStr || "");
}

// Many third-party "PDF viewer" extensions (Adobe Acrobat, Chrome's own
// built-in viewer, etc.) open PDFs inside a chrome-extension:// page that
// simply wraps the original document URL, e.g.
//   chrome-extension://efaidnbmnnnibpcajpcglclefindmkaj/https://arxiv.org/pdf/1706.03762
//   chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?file=https%3A%2F%2F...
// Feeding that wrapper URL straight to pdf.js's fetch causes "Unexpected
// server response (0)" since it isn't a fetchable resource — we need to
// pull the real document URL back out first.
function resolvePdfTargetUrl(pdfUrl) {
  if (pdfUrl.includes("ieeexplore.ieee.org/stamp/stamp.jsp")) {
    return pdfUrl.replace("/stamp/stamp.jsp", "/stampPDF/getPDF.jsp");
  }

  if (pdfUrl.startsWith("chrome-extension://") || pdfUrl.startsWith("moz-extension://")) {
    try {
      const url = new URL(pdfUrl);
      const fileParam = url.searchParams.get("file") || url.searchParams.get("url");
      if (fileParam) {
        try { return decodeURIComponent(fileParam); } catch { return fileParam; }
      }
    } catch {}

    const embedded = pdfUrl.match(
      /^(?:chrome|moz)-extension:\/\/[a-z0-9]+\/+(https?(?:%3[aA]|:)(?:%2[fF]|\/){2}.+)$/
    );
    if (embedded) {
      let inner = embedded[1];
      try { inner = decodeURIComponent(inner); } catch {}
      return inner;
    }
  }

  if (pdfUrl.includes("file=") && pdfUrl.includes(".pdf")) {
    const m = pdfUrl.match(/file=([^&]+)/);
    if (m && m[1]) {
      try { return decodeURIComponent(m[1]); } catch { return m[1]; }
    }
  }

  return pdfUrl;
}

function isPdfUrl(urlStr) {
  if (!urlStr) return false;
  const candidate = resolvePdfTargetUrl(urlStr);
  // Successfully unwrapped from a viewer-extension URL — treat as a PDF
  // regardless of whether the underlying URL happens to end in ".pdf"
  // (e.g. arxiv.org/pdf/1706.03762 has no extension at all).
  if (candidate !== urlStr && /^https?:\/\//i.test(candidate)) return true;

  const lower = candidate.toLowerCase();
  const title = (typeof pageTitleEl !== "undefined" ? pageTitleEl.textContent : "").toLowerCase();
  try {
    const path = new URL(candidate).pathname.toLowerCase();
    if (path.endsWith(".pdf") || path.includes("/pdf/") || path.includes("/pdfviewer/")) return true;
  } catch {}
  if (lower.includes(".pdf?") || lower.includes(".pdf#")) return true;
  if (lower.startsWith("file://") && lower.includes(".pdf")) return true;
  if (title.endsWith(".pdf") || title.includes("pdf reader") || title.includes("pdf viewer")) return true;
  if (lower.includes("ieeexplore.ieee.org/stamp/stamp.jsp")) return true;
  if (lower.includes("file=") && lower.includes(".pdf")) return true;
  return false;
}

// A PDF tab (native Chrome viewer or a third-party viewer extension) can
// never have a content script injected into it, so we can't scroll/highlight
// like on a normal page. What every mainstream viewer *does* honor, though,
// is the long-standing "#page=N" open-parameter convention (Adobe's original
// spec, implemented by Chromium's own PDFium viewer and by pdf.js-based
// extensions) — navigating the tab there jumps to the right page without
// needing any injection permission at all.
function normalizeForSearch(s) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function cleanSnippet(s) {
  if (!s) return "";
  let clean = s.trim();
  // Strip starting/ending quotation marks if they are balanced or present
  clean = clean.replace(/^["'“‘](.*)["'”’]$/s, "$1").trim();
  // If it still starts/ends with quotes, strip them
  clean = clean.replace(/^["'“‘]+/, "").replace(/["'”’]+$/, "").trim();
  // Strip common prefixes
  clean = clean.replace(/^(excerpt|snippet|answer|verbatim|text|quote):\s*/i, "").trim();
  return clean;
}

// getPdfText() tags each page's extracted text with "--- Page N ---", so
// finding which page a snippet came from is just locating which page-chunk
// contains it (whitespace-insensitively, since pdf.js's item-joined text
// doesn't always match the LLM's returned wording byte-for-byte).
function findPdfPageForSnippet(pageContent, snippet) {
  const cleaned = cleanSnippet(snippet);
  const needle = normalizeForSearch(cleaned);
  if (!needle) return null;
  const chunks = pageContent.split(/--- Page (\d+) ---/);
  // String#split with a capturing group interleaves the results:
  // ["", "1", "<page 1 text>", "2", "<page 2 text>", ...]
  
  // Try 1: Match 80 characters
  const needle80 = needle.slice(0, 80);
  for (let i = 1; i < chunks.length; i += 2) {
    const pageNum = parseInt(chunks[i], 10);
    const text = normalizeForSearch(chunks[i + 1] || "");
    if (text.includes(needle80)) return pageNum;
  }

  // Try 2: Fallback to match 40 characters
  const needle40 = needle.slice(0, 40);
  if (needle40.length >= 10) {
    for (let i = 1; i < chunks.length; i += 2) {
      const pageNum = parseInt(chunks[i], 10);
      const text = normalizeForSearch(chunks[i + 1] || "");
      if (text.includes(needle40)) return pageNum;
    }
  }

  return null;
}

function withPageFragment(urlStr, pageNum) {
  try {
    const url = new URL(urlStr);
    url.hash = `page=${pageNum}`;
    return url.toString();
  } catch {
    return urlStr;
  }
}

// ─── PDF Actions ──────────────────────────────────────────────────────────────
const PDF_ACTIONS = [
  { id: "summarize-pdf",      label: "Summarize PDF",        icon: "📋" },
  { id: "search-pdf",         label: "Search PDF",           icon: "🔍" },
  { id: "explain-equations",  label: "Explain equations",    icon: "🔬" },
  { id: "flashcards",         label: "Generate flashcards",  icon: "🃏" },
  { id: "extract-tables",     label: "Extract tables",       icon: "📊" },
  { id: "citation",           label: "Citation & Reference",  icon: "📚" },
];

// ─── PDF Text Extraction ──────────────────────────────────────────────────────
async function getPdfText(pdfUrl) {
  try {
    if (typeof pdfjsLib === "undefined") {
      throw new Error("PDF.js library not loaded. Try reloading the extension.");
    }
    // Ensure the worker is loaded correctly from local URL in extension
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.js");

    const targetUrl = resolvePdfTargetUrl(pdfUrl);
    let pdfDataOptions;

    if (targetUrl.startsWith("file://")) {
      try {
        const res = await fetch(targetUrl);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const buffer = await res.arrayBuffer();
        pdfDataOptions = { data: new Uint8Array(buffer) };
      } catch (err) {
        throw new Error("Cannot access local file. Go to chrome://extensions → Research OS → Details → enable 'Allow access to file URLs'.");
      }
    } else {
      // Fetch via background script to bypass CORS
      pdfDataOptions = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "FETCH_PDF", url: targetUrl }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.ok) {
            try {
              // Convert base64 back to Uint8Array
              const binaryString = atob(response.data);
              const len = binaryString.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              resolve({ data: bytes });
            } catch (err) {
              reject(new Error("Failed to decode PDF data: " + err.message));
            }
          } else {
            reject(new Error(response?.error || "Failed to fetch PDF in background"));
          }
        });
      });
    }

    const loadingTask = pdfjsLib.getDocument(pdfDataOptions);
    const pdf = await loadingTask.promise;
    let fullText = "";
    const maxPages = Math.min(pdf.numPages, 100);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const pageText = tc.items.map(item => item.str).join(" ");
      fullText += `--- Page ${i} ---\n${pageText.trim()}\n\n`;
    }
    if (pdf.numPages > 100) fullText += "\n[... PDF truncated beyond page 100 ...]";
    return { text: fullText.trim(), pagesCount: pdf.numPages };
  } catch (err) {
    throw new Error("PDF Extraction Error: " + err.message);
  }
}

// ─── Backend SSE Streaming for mode actions ───────────────────────────────────
async function streamModeQuestion(question, contextText) {
  addMessage("user", question);
  const shouldStick = isNearBottom();
  typingEl = showTyping();
  streamingForTabId = activeTabId;
  setSending(true);

  const backendUrl = await (async () => {
    const { backendUrl } = await chrome.storage.sync.get("backendUrl");
    return backendUrl || "http://localhost:8000";
  })();
  const { model } = await chrome.storage.sync.get("model");
  const resolvedModel = model || "llama-3.1-8b-instant";

  if (!port) connectPort();
  port.postMessage({
    type: "ASK",
    tabId: activeTabId,
    question,
    context: contextText
  });
}

// ─── PDF Action Handler ───────────────────────────────────────────────────────
async function handlePdfAction(actionId) {
  pdfMenuEl.style.display = "none";

  let pdfUrl = activeTabUrl;
  if (!isPdfUrl(activeTabUrl)) {
    const input = prompt(
      "PDF Mode is active, but this page is not a PDF file. Enter a PDF document URL:",
      "https://example.com/document.pdf"
    );
    if (!input) return;
    pdfUrl = input.trim();
  }

  addMessage("user", `⏳ Loading PDF…`);
  let pdfData;
  try {
    pdfData = await getPdfText(pdfUrl);
  } catch (err) {
    messagesEl.querySelector(".msg-row:last-child")?.remove();
    addMessage("error", err.message);
    setSending(false);
    return;
  }
  messagesEl.querySelector(".msg-row:last-child")?.remove();

  const maxContextChars = 15000;
  let pdfText = pdfData.text || "";
  if (pdfText.length > maxContextChars) {
    pdfText = pdfText.slice(0, maxContextChars) + "\n\n[... PDF content truncated to fit token limits ...]";
  }
  const contextText = `[PDF Document — ${pdfData.pagesCount} pages]\n${pdfText}`;

  const prompts = {
    "summarize-pdf":     "Provide a comprehensive summary of this PDF document. Cover the main topics, findings, and conclusions.",
    "search-pdf":        "List the key concepts, terms, and topics in this document with brief explanations and page references.",
    "explain-equations": "Identify and explain all mathematical equations, formulas, and technical notation in this document in plain language.",
    "flashcards":        "Create 8 study flashcards (Q&A format) based on the most important content in this document.",
    "extract-tables":    "Extract and present all tables, figures, and structured data from this document in a clear format.",
    "citation":          "Generate proper citations for this document in APA, MLA, and BibTeX formats.",
  };

  const question = prompts[actionId] || "Analyze this PDF document.";
  streamModeQuestion(question, contextText);
}

// ─── Smart Search Handler ─────────────────────────────────────────────────────
async function executeSmartSearch(query) {
  if (!query || !activeTabId || !activeTabUrl) return;
  smartSearchStatusEl.style.display = "block";
  smartSearchStatusEl.textContent = "Analyzing page content…";
  smartSearchSubmitBtnEl.disabled = true;

  try {
    let pageContent = "";
    if (isPdfUrl(activeTabUrl)) {
      const pdfData = await getPdfText(activeTabUrl);
      pageContent = pdfData.text;
    } else if (isScriptableTabUrl(activeTabUrl)) {
      await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ["content.js"] });
      const page = await chrome.tabs.sendMessage(activeTabId, { type: "EXTRACT_PAGE_TEXT" });
      pageContent = page?.content || "";
    } else {
      throw new Error(
        "Smart Search can't read this page — it's a browser-internal page or belongs to another extension."
      );
    }

    if (!pageContent) throw new Error("Could not read any text content on this page.");

    const systemPrompt =
      "You are a precise search assistant.\n" +
      "Given a user's question, extract the EXACT sentence or short paragraph from the provided page content that best answers it.\n" +
      "Return ONLY that exact verbatim text excerpt — nothing else. No intro, no quotes.";

    const backendUrl = await (async () => {
      const { backendUrl } = await chrome.storage.sync.get("backendUrl");
      return backendUrl || "http://localhost:8000";
    })();
    const { model } = await chrome.storage.sync.get("model");
    const resolvedModel = model || "llama-3.1-8b-instant";

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Page content:\n${pageContent.slice(0, 15000)}\n\nUser question: ${query}` }
    ];

    // Must match the backend API background.js's streamChat uses — this
    // backend doesn't implement the OpenAI-style /v1/chat/completions path.
    const res = await fetch(`${backendUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "groq", model: resolvedModel, messages, stream: true })
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Backend error ${res.status}: ${detail || res.statusText}`);
    }

    let snippet = "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on newlines but hold back a possibly-incomplete trailing line
      // until the next chunk arrives — a chunk boundary can land mid-line.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content || "";
          snippet += delta;
        } catch {}
      }
    }
    snippet = snippet.trim();

    if (!snippet) throw new Error("Could not locate a matching section on the page.");

    const cleanedSnippet = cleanSnippet(snippet);
    let jumpedToPage = null;
    let scrollResult = null;

    if (isPdfUrl(activeTabUrl)) {
      const pageNum = findPdfPageForSnippet(pageContent, cleanedSnippet);
      if (pageNum) {
        try {
          await chrome.tabs.update(activeTabId, { url: withPageFragment(activeTabUrl, pageNum) });
          jumpedToPage = pageNum;
        } catch {
          jumpedToPage = null;
        }
      }
    } else if (isScriptableTabUrl(activeTabUrl)) {
      try {
        scrollResult = await triggerScrollOrJump(cleanedSnippet, pageContent);
      } catch {}
    }

    const isSuccess = !!(scrollResult?.result || jumpedToPage);
    const shortSnippet = cleanedSnippet.length > 180 ? cleanedSnippet.slice(0, 180) + "…" : cleanedSnippet;
    
    smartSearchStatusEl.style.display = "block";
    smartSearchStatusEl.innerHTML = "";
    
    const card = document.createElement("div");
    card.className = `search-result-card ${isSuccess ? 'success-match' : 'no-match'}`;
    
    const header = document.createElement("div");
    header.className = "result-card-header";
    
    const badge = document.createElement("span");
    badge.className = `result-badge ${isSuccess ? 'success' : 'error'}`;
    badge.textContent = isSuccess ? "Match Found" : "Not Found";
    header.appendChild(badge);
    
    if (isSuccess) {
      const jumpBtn = document.createElement("button");
      jumpBtn.type = "button";
      jumpBtn.className = "result-jump-btn";
      jumpBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> Jump to section`;
      jumpBtn.addEventListener("click", () => {
        triggerScrollOrJump(cleanedSnippet, pageContent);
      });
      header.appendChild(jumpBtn);
    }
    card.appendChild(header);
    
    const body = document.createElement("div");
    body.className = "result-card-body";
    body.textContent = `"${shortSnippet}"`;
    card.appendChild(body);
    
    const statusMsg = document.createElement("div");
    statusMsg.style.fontSize = "11px";
    statusMsg.style.marginTop = "6px";
    statusMsg.style.color = "var(--text-muted)";
    
    if (scrollResult?.result) {
      statusMsg.textContent = "Scrolled to and highlighted the matching section on the page.";
    } else if (jumpedToPage) {
      statusMsg.textContent = `Jumped to page ${jumpedToPage} of the PDF document.`;
    } else {
      statusMsg.textContent = isPdfUrl(activeTabUrl)
        ? "Couldn't locate the exact page this text is on in the PDF."
        : "Found the text, but couldn't locate it on the page to scroll to (it may be in a collapsed section or dynamic tab).";
    }
    card.appendChild(statusMsg);
    
    smartSearchStatusEl.appendChild(card);

  } catch (err) {
    smartSearchStatusEl.innerHTML = `<div class="search-result-card no-match"><div class="result-card-header"><span class="result-badge error">Error</span></div><div class="result-card-body" style="color: var(--error-text); font-style: normal;">${err.message}</div></div>`;
  } finally {
    smartSearchSubmitBtnEl.disabled = false;
  }
}

async function triggerScrollOrJump(cleanedSnippet, pageContent) {
  if (isPdfUrl(activeTabUrl)) {
    const pageNum = findPdfPageForSnippet(pageContent, cleanedSnippet);
    if (pageNum) {
      try {
        await chrome.tabs.update(activeTabId, { url: withPageFragment(activeTabUrl, pageNum) });
        return { result: true };
      } catch (err) {
        console.error("PDF page jump failed", err);
      }
    }
  } else if (isScriptableTabUrl(activeTabUrl)) {
    try {
      const [scrollResult] = await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: (targetText) => {
          const cleanText = (s) => s.replace(/\s+/g, " ").trim();
          const needle = cleanText(targetText);
          if (!needle) return false;

          const highlightElement = (el) => {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            const orig = el.style.cssText;
            el.style.transition = "background 0.3s";
            el.style.background = "#fef08a";
            setTimeout(() => { el.style.cssText = orig; }, 2500);
          };

          // 1. Try exact full needle
          try {
            window.getSelection().removeAllRanges();
            let found = window.find(needle, false, false, true);
            if (found) {
              const sel = window.getSelection();
              if (sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const el = range.startContainer.parentElement;
                if (el) {
                  highlightElement(el);
                  return true;
                }
              }
            }
          } catch (e) {}

          // 2. Try smaller clauses (split by punctuation / newlines)
          const clauses = needle.split(/[\n:;•·\-\*]|\.\s+/)
            .map(c => c.trim())
            .filter(c => c.length >= 15);
          for (const clause of clauses) {
            try {
              window.getSelection().removeAllRanges();
              let found = window.find(clause, false, false, true);
              if (found) {
                const sel = window.getSelection();
                if (sel.rangeCount > 0) {
                  const range = sel.getRangeAt(0);
                  const el = range.startContainer.parentElement;
                  if (el) {
                    highlightElement(el);
                    return true;
                  }
                }
              }
            } catch (e) {}
          }

          // 3. Try sliding windows of 4 words
          const words = needle.split(/[\s:;().,!?\[\]{}""'']+/).filter(w => w.length >= 2);
          for (let i = 0; i <= words.length - 4; i++) {
            const windowText = words.slice(i, i + 4).join(" ");
            if (windowText.length >= 15) {
              try {
                window.getSelection().removeAllRanges();
                let found = window.find(windowText, false, false, true);
                if (found) {
                  const sel = window.getSelection();
                  if (sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    const el = range.startContainer.parentElement;
                    if (el) {
                      highlightElement(el);
                      return true;
                    }
                  }
                }
              } catch (e) {}
            }
          }

          // 4. Try sliding windows of 3 words
          for (let i = 0; i <= words.length - 3; i++) {
            const windowText = words.slice(i, i + 3).join(" ");
            if (windowText.length >= 10) {
              try {
                window.getSelection().removeAllRanges();
                let found = window.find(windowText, false, false, true);
                if (found) {
                  const sel = window.getSelection();
                  if (sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    const el = range.startContainer.parentElement;
                    if (el) {
                      highlightElement(el);
                      return true;
                    }
                  }
                }
              } catch (e) {}
            }
          }

          // 5. Fallback: TreeWalker to find single text node
          const normalize = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
          const searchLower = needle.toLowerCase().slice(0, 60);
          if (!searchLower) return false;

          const walker = document.createTreeWalker(
            document.body, NodeFilter.SHOW_TEXT, null
          );
          let node;
          while ((node = walker.nextNode())) {
            if (normalize(node.nodeValue).includes(searchLower)) {
              const el = node.parentElement;
              if (el) {
                highlightElement(el);
                return true;
              }
            }
          }
          return false;
        },
        args: [cleanedSnippet]
      });
      return scrollResult;
    } catch (err) {
      console.error("Scriptable tab jump failed", err);
    }
  }
  return null;
}

// ─── PDF Menu Listeners ───────────────────────────────────────────────────────
if (pdfModeBtnEl) {
  pdfModeBtnEl.addEventListener("click", () => {
    const open = pdfMenuEl.style.display !== "none" && pdfMenuEl.style.display !== "";
    if (open) {
      pdfMenuEl.style.display = "none";
    } else {
      // Populate action grid
      pdfActionsGridEl.innerHTML = "";
      PDF_ACTIONS.forEach(action => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "github-action-card";
        btn.innerHTML = `<span class="action-icon">${action.icon}</span><span class="action-label">${action.label}</span>`;
        btn.addEventListener("click", () => handlePdfAction(action.id));
        pdfActionsGridEl.appendChild(btn);
      });
      // Close other menus
      githubMenuEl.style.display = "none";
      smartSearchPanelEl.style.display = "none";
      pdfMenuEl.style.display = "flex";
    }
  });
}
if (closePdfBtn) {
  closePdfBtn.addEventListener("click", () => { pdfMenuEl.style.display = "none"; });
}

// ─── Smart Search Listeners ───────────────────────────────────────────────────
if (smartSearchBtnEl) {
  smartSearchBtnEl.addEventListener("click", () => {
    const open = smartSearchPanelEl.style.display !== "none" && smartSearchPanelEl.style.display !== "";
    if (open) {
      smartSearchPanelEl.style.display = "none";
    } else {
      githubMenuEl.style.display = "none";
      pdfMenuEl.style.display = "none";
      smartSearchStatusEl.style.display = "none";
      smartSearchStatusEl.textContent = "";
      smartSearchPanelEl.style.display = "flex";
      smartSearchInputEl.focus();
    }
  });
}
if (closeSmartSearchBtnEl) {
  closeSmartSearchBtnEl.addEventListener("click", () => { smartSearchPanelEl.style.display = "none"; });
}
if (smartSearchSubmitBtnEl) {
  smartSearchSubmitBtnEl.addEventListener("click", () => {
    const q = smartSearchInputEl.value.trim();
    if (q) executeSmartSearch(q);
  });
}
if (smartSearchInputEl) {
  smartSearchInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = smartSearchInputEl.value.trim();
      if (q) executeSmartSearch(q);
    }
  });
}

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

  // Hide all overlays on tab change
  if (featuresDropdownMenu) featuresDropdownMenu.style.display = "none";
  githubMenuEl.style.display = "none";
  if (pdfMenuEl) pdfMenuEl.style.display = "none";
  if (smartSearchPanelEl) smartSearchPanelEl.style.display = "none";
  if (typeof litPanelEl !== "undefined" && litPanelEl) {
    litPanelEl.style.display = "none";
    litDetailsModalEl.style.display = "none";
  }
  if (typeof dsPanelEl !== "undefined" && dsPanelEl) {
    dsPanelEl.style.display = "none";
  }

  // GitHub button & dropdown item — context check
  const gitContext = parseGitHubUrl(tabUrl);
  if (githubModeBtnEl) {
    githubModeBtnEl.style.display = "none";
  }
  if (dropdownGithub) {
    if (gitContext) {
      dropdownGithub.classList.remove("disabled");
    } else {
      dropdownGithub.classList.add("disabled");
    }
  }

  // Hide legacy header buttons (features are now accessed via the Features dropdown)
  if (pdfModeBtnEl) pdfModeBtnEl.style.display = "none";
  if (smartSearchBtnEl) smartSearchBtnEl.style.display = "none";

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

async function sendQuestion(question, context) {
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

  let resolvedContext = context;
  if (!resolvedContext && isPdfUrl(activeTabUrl)) {
    try {
      const pdfData = await getPdfText(activeTabUrl);
      const maxContextChars = 15000;
      let pdfText = pdfData.text || "";
      if (pdfText.length > maxContextChars) {
        pdfText = pdfText.slice(0, maxContextChars) + "\n\n[... PDF content truncated to fit token limits ...]";
      }
      resolvedContext = `[PDF Document — ${pdfData.pagesCount} pages]\n${pdfText}`;
    } catch (err) {
      console.error("Failed to extract PDF context for chat:", err);
    }
  }

  if (!port) connectPort();
  port.postMessage({ type: "ASK", tabId: activeTabId, question, context: resolvedContext });
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

  // Sync deletion to server if authenticated
  const { authToken: token } = await chrome.storage.local.get("authToken");
  if (token) {
    const backendUrl = await getBackendUrl();
    try {
      await fetch(`${backendUrl}/chat/history?url=${encodeURIComponent(activeTabUrl)}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
    } catch (err) {
      console.error("Failed to sync clear history deletion to server:", err);
    }
  }

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

// ─── Literature Search Logic ──────────────────────────────────────────────────
const litSearchBtnEl = document.getElementById("literatureSearchBtn");
const litPanelEl = document.getElementById("literatureSearchPanel");
const closeLitBtnEl = document.getElementById("closeLiteratureSearchBtn");
const litSearchInputEl = document.getElementById("litSearchInput");
const litSearchSubmitBtnEl = document.getElementById("litSearchSubmitBtn");
const litSuggestionsEl = document.getElementById("litSuggestions");
const litRecentSearchesEl = document.getElementById("litRecentSearches");
const litRecentChipsEl = document.getElementById("litRecentChips");
const litToggleFiltersBtnEl = document.getElementById("litToggleFiltersBtn");
const litFiltersContentEl = document.getElementById("litFiltersContent");
const litFiltersArrowEl = document.getElementById("litFiltersArrow");
const litSourceSelectEl = document.getElementById("litSourceSelect");
const litSortSelectEl = document.getElementById("litSortSelect");
const litYearInputEl = document.getElementById("litYearInput");
const litOpenAccessCheckEl = document.getElementById("litOpenAccessCheck");
const litTrendingHeaderEl = document.getElementById("litTrendingHeader");
const litSkeletonLoaderEl = document.getElementById("litSkeletonLoader");
const litEmptyStateEl = document.getElementById("litEmptyState");
const litResultsContainerEl = document.getElementById("litResultsContainer");
const litPaginationEl = document.getElementById("litPagination");
const litPrevPageBtnEl = document.getElementById("litPrevPageBtn");
const litPageNumEl = document.getElementById("litPageNum");
const litNextPageBtnEl = document.getElementById("litNextPageBtn");

// Details modal elements
const litDetailsModalEl = document.getElementById("litDetailsModal");
const litModalSourceEl = document.getElementById("litModalSource");
const litCloseModalBtnEl = document.getElementById("litCloseModalBtn");
const litModalTitleEl = document.getElementById("litModalTitle");
const litModalAuthorsEl = document.getElementById("litModalAuthors");
const litModalVenueEl = document.getElementById("litModalVenue");
const litModalYearEl = document.getElementById("litModalYear");
const litModalCitationsEl = document.getElementById("litModalCitations");
const litModalAbstractEl = document.getElementById("litModalAbstract");
const litModalPdfBtnEl = document.getElementById("litModalPdfBtn");
const litModalSimilarBtnEl = document.getElementById("litModalSimilarBtn");

let litCurrentPage = 1;
const litPageSize = 10;
let litSearchQuery = "";
let litActivePaper = null;
let litSuggestionsTimeout = null;

function escapeHTML(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showLiteraturePanel(show) {
  if (show) {
    githubMenuEl.style.display = "none";
    if (pdfMenuEl) pdfMenuEl.style.display = "none";
    if (smartSearchPanelEl) smartSearchPanelEl.style.display = "none";
    
    litPanelEl.style.display = "flex";
    renderRecentSearchChips();
    if (!litSearchQuery) {
      loadTrendingPapers();
    }
  } else {
    litPanelEl.style.display = "none";
    litDetailsModalEl.style.display = "none";
  }
}

async function executeLiteratureSearch(query, page = 1) {
  if (!query || !query.trim()) return;
  litSearchQuery = query;
  litCurrentPage = page;
  
  saveRecentSearch(query);
  renderRecentSearchChips();
  
  litResultsContainerEl.innerHTML = "";
  litTrendingHeaderEl.style.display = "none";
  litEmptyStateEl.style.display = "none";
  litSkeletonLoaderEl.style.display = "flex";
  litPaginationEl.style.display = "none";
  
  const { backendUrl, ieeeApiKey, serpApiKey } = await chrome.storage.sync.get([
    "backendUrl",
    "ieeeApiKey",
    "serpApiKey"
  ]);
  const resolvedBackend = backendUrl || "http://localhost:8000";
  
  const source = litSourceSelectEl.value;
  const sort = litSortSelectEl.value;
  const year = litYearInputEl.value.trim();
  const openAccess = litOpenAccessCheckEl.checked;
  const offset = (page - 1) * litPageSize;
  
  if (source === "scholar" && !serpApiKey) {
    litSkeletonLoaderEl.style.display = "none";
    litResultsContainerEl.innerHTML = `
      <div class="popup-error" style="background: var(--bg-subtle); color: var(--text); border: 1px solid var(--border); padding: 12px; display: flex; flex-direction: column; gap: 8px; text-align: center; border-radius: 6px; margin: 10px;">
        <span style="font-weight: 700; font-size: 12px; color: var(--text);">SerpAPI Key Required</span>
        <span style="font-size: 11px; color: var(--text-muted);">Direct Google Scholar search requires a SerpAPI Key in settings. You can search directly on their website:</span>
        <a href="https://scholar.google.com/scholar?q=${encodeURIComponent(query)}" target="_blank" class="ds-action-btn ds-action-btn-primary" style="margin: 4px auto 0 auto; text-decoration: none; padding: 4px 12px; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; height: 26px; border-radius: 4px;">🔍 Search on Google Scholar</a>
      </div>
    `;
    return;
  }
  
  let url = `${resolvedBackend}/literature/search?query=${encodeURIComponent(query)}&source=${source}&sort=${sort}&limit=${litPageSize}&offset=${offset}`;
  if (year) url += `&year=${encodeURIComponent(year)}`;
  if (openAccess) url += `&open_access=true`;
  if (ieeeApiKey) url += `&ieee_api_key=${encodeURIComponent(ieeeApiKey)}`;
  if (serpApiKey) url += `&serp_api_key=${encodeURIComponent(serpApiKey)}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Search failed");
    const data = await res.json();
    
    litSkeletonLoaderEl.style.display = "none";
    const results = data.results || [];
    
    if (results.length === 1 && results[0].id === "SCHOLAR_KEY_REQUIRED") {
      litResultsContainerEl.innerHTML = `
        <div class="popup-error" style="background: var(--bg-subtle); color: var(--text); border: 1px solid var(--border); padding: 12px; display: flex; flex-direction: column; gap: 8px; text-align: center; border-radius: 6px; margin: 10px;">
          <span style="font-weight: 700; font-size: 12px; color: var(--text);">SerpAPI Key Required</span>
          <span style="font-size: 11px; color: var(--text-muted);">Direct Google Scholar search requires a SerpAPI Key in settings. You can search directly on their website:</span>
          <a href="https://scholar.google.com/scholar?q=${encodeURIComponent(query)}" target="_blank" class="ds-action-btn ds-action-btn-primary" style="margin: 4px auto 0 auto; text-decoration: none; padding: 4px 12px; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; height: 26px; border-radius: 4px;">🔍 Search on Google Scholar</a>
        </div>
      `;
      return;
    }
    
    if (results.length === 0) {
      litEmptyStateEl.style.display = "block";
      return;
    }
    
    renderResults(results);
    
    litPaginationEl.style.display = "flex";
    litPageNumEl.textContent = `Page ${page}`;
    litPrevPageBtnEl.disabled = page === 1;
    litNextPageBtnEl.disabled = results.length < litPageSize;
  } catch (err) {
    console.error("Literature search error:", err);
    litSkeletonLoaderEl.style.display = "none";
    litResultsContainerEl.innerHTML = `<div class="popup-error" style="margin: 10px;">Error: ${err.message || String(err)}</div>`;
  }
}

async function loadTrendingPapers() {
  litResultsContainerEl.innerHTML = "";
  litTrendingHeaderEl.style.display = "block";
  litEmptyStateEl.style.display = "none";
  litSkeletonLoaderEl.style.display = "flex";
  litPaginationEl.style.display = "none";
  
  const { backendUrl } = await chrome.storage.sync.get("backendUrl");
  const resolvedBackend = backendUrl || "http://localhost:8000";
  
  try {
    const res = await fetch(`${resolvedBackend}/literature/trending?limit=10`);
    if (!res.ok) throw new Error("Trending papers failed");
    const data = await res.json();
    
    litSkeletonLoaderEl.style.display = "none";
    const results = data.results || [];
    if (results.length === 0) {
      litEmptyStateEl.style.display = "block";
      return;
    }
    renderResults(results);
  } catch (err) {
    console.error("Trending papers error:", err);
    litSkeletonLoaderEl.style.display = "none";
    litResultsContainerEl.innerHTML = `<div class="popup-error" style="margin: 10px;">Error: ${err.message || String(err)}</div>`;
  }
}

async function executeSimilarSearch(paperId) {
  litResultsContainerEl.innerHTML = "";
  litTrendingHeaderEl.style.display = "none";
  litEmptyStateEl.style.display = "none";
  litSkeletonLoaderEl.style.display = "flex";
  litPaginationEl.style.display = "none";
  litDetailsModalEl.style.display = "none";
  
  const { backendUrl } = await chrome.storage.sync.get("backendUrl");
  const resolvedBackend = backendUrl || "http://localhost:8000";
  
  try {
    const res = await fetch(`${resolvedBackend}/literature/similar?paper_id=${encodeURIComponent(paperId)}&limit=10`);
    if (!res.ok) throw new Error("Similar search failed");
    const data = await res.json();
    
    litSkeletonLoaderEl.style.display = "none";
    const results = data.results || [];
    if (results.length === 0) {
      litEmptyStateEl.style.display = "block";
      return;
    }
    renderResults(results);
  } catch (err) {
    console.error("Similar search error:", err);
    litSkeletonLoaderEl.style.display = "none";
    litResultsContainerEl.innerHTML = `<div class="popup-error" style="margin: 10px;">Error: ${err.message || String(err)}</div>`;
  }
}

function renderResults(results) {
  litResultsContainerEl.innerHTML = "";
  
  results.forEach(paper => {
    const card = document.createElement("div");
    card.className = "lit-paper-card";
    
    const authorsStr = (paper.authors || []).join(", ") || "Unknown Authors";
    const yearStr = paper.year ? `(${paper.year})` : "";
    const venueStr = paper.venue || paper.source || "Academic Venue";
    
    let sourceBadgeClass = "lit-badge-semantic";
    if (paper.source === "arXiv") sourceBadgeClass = "lit-badge-arxiv";
    if (paper.source === "OpenAlex") sourceBadgeClass = "lit-badge-openalex";
    if (paper.source && paper.source.includes("IEEE")) sourceBadgeClass = "lit-badge-ieee";
    if (paper.source && paper.source.includes("Scholar")) sourceBadgeClass = "lit-badge-scholar";
    if (paper.source && paper.source.includes("Scientific Data")) sourceBadgeClass = "lit-badge-nature";
    
    const oaBadge = paper.pdfLink ? `<span class="lit-oa-badge">Open Access</span>` : "";
    
    card.innerHTML = `
      <h3 class="lit-paper-title" style="text-align: left;">${escapeHTML(paper.title)}</h3>
      <div class="lit-paper-authors" style="text-align: left;">${escapeHTML(authorsStr)} ${yearStr}</div>
      <p class="lit-paper-abstract-preview" style="text-align: left;">${escapeHTML(paper.abstract || "No abstract preview available.")}</p>
      <div class="lit-paper-meta-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
          <span class="lit-badge ${sourceBadgeClass}" style="flex-shrink: 0;">${escapeHTML(paper.source)}</span>
          <span class="lit-venue-text" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; font-size: 10px; color: var(--text-muted); font-weight: 600;" title="${escapeHTML(venueStr)}">${escapeHTML(venueStr)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          ${oaBadge}
          <span class="lit-citation-badge" style="font-weight: 700; color: var(--primary);">${paper.citationCount || 0} citations</span>
        </div>
      </div>
    `;
    
    card.addEventListener("click", () => {
      showPaperDetails(paper);
    });
    
    litResultsContainerEl.appendChild(card);
  });
}

function showPaperDetails(paper) {
  litActivePaper = paper;
  litModalSourceEl.textContent = paper.source;
  
  let sourceBadgeClass = "lit-badge-semantic";
  if (paper.source === "arXiv") sourceBadgeClass = "lit-badge-arxiv";
  if (paper.source === "OpenAlex") sourceBadgeClass = "lit-badge-openalex";
  
  litModalSourceEl.className = `lit-details-source lit-badge ${sourceBadgeClass}`;
  
  litModalTitleEl.textContent = paper.title;
  litModalAuthorsEl.textContent = (paper.authors || []).join(", ") || "Unknown Authors";
  litModalVenueEl.textContent = paper.venue || paper.source || "Academic Venue";
  litModalYearEl.textContent = paper.year || "Unknown Year";
  litModalCitationsEl.textContent = `${paper.citationCount || 0} citations`;
  litModalAbstractEl.textContent = paper.abstract || "No abstract available.";
  
  if (paper.pdfLink) {
    litModalPdfBtnEl.href = paper.pdfLink;
    litModalPdfBtnEl.style.display = "inline-flex";
  } else {
    litModalPdfBtnEl.style.display = "none";
  }
  
  litDetailsModalEl.style.display = "flex";
}

function saveRecentSearch(query) {
  if (!query || !query.trim()) return;
  chrome.storage.local.get({ litRecentSearches: [] }, (data) => {
    let searches = data.litRecentSearches || [];
    searches = searches.filter(s => s.toLowerCase() !== query.toLowerCase());
    searches.unshift(query);
    searches = searches.slice(0, 5);
    chrome.storage.local.set({ litRecentSearches: searches });
  });
}

function renderRecentSearchChips() {
  chrome.storage.local.get({ litRecentSearches: [] }, (data) => {
    const searches = data.litRecentSearches || [];
    if (searches.length === 0) {
      litRecentSearchesEl.style.display = "none";
      return;
    }
    
    litRecentSearchesEl.style.display = "flex";
    litRecentChipsEl.innerHTML = "";
    
    searches.forEach(search => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "lit-chip";
      chip.textContent = search;
      chip.addEventListener("click", () => {
        litSearchInputEl.value = search;
        executeLiteratureSearch(search, 1);
      });
      litRecentChipsEl.appendChild(chip);
    });
  });
}


// ─── Dataset Search Logic ────────────────────────────────────────────────────
const dsSearchBtnEl = document.getElementById("datasetSearchBtn");
const dsPanelEl = document.getElementById("datasetSearchPanel");
const closeDsBtnEl = document.getElementById("closeDatasetSearchBtn");
const dsSearchInputEl = document.getElementById("dsSearchInput");
const dsSearchSubmitBtnEl = document.getElementById("dsSearchSubmitBtn");
const dsSuggestionsEl = document.getElementById("dsSuggestions");
const dsRecentSearchesEl = document.getElementById("dsRecentSearches");
const dsRecentChipsEl = document.getElementById("dsRecentChips");
const dsToggleFiltersBtnEl = document.getElementById("dsToggleFiltersBtn");
const dsFiltersContentEl = document.getElementById("dsFiltersContent");
const dsFiltersArrowEl = document.getElementById("dsFiltersArrow");
const dsSourceSelectEl = document.getElementById("dsSourceSelect");
const dsDomainSelectEl = document.getElementById("dsDomainSelect");
const dsTaskSelectEl = document.getElementById("dsTaskSelect");
const dsModalitySelectEl = document.getElementById("dsModalitySelect");
const dsSizeSelectEl = document.getElementById("dsSizeSelect");
const dsLicenseInputEl = document.getElementById("dsLicenseInput");
const dsSortSelectEl = document.getElementById("dsSortSelect");
const dsSkeletonLoaderEl = document.getElementById("dsSkeletonLoader");
const dsEmptyStateEl = document.getElementById("dsEmptyState");
const dsResultsContainerEl = document.getElementById("dsResultsContainer");
const dsPaginationEl = document.getElementById("dsPagination");
const dsPrevPageBtnEl = document.getElementById("dsPrevPageBtn");
const dsPageNumEl = document.getElementById("dsPageNum");
const dsNextPageBtnEl = document.getElementById("dsNextPageBtn");

let dsCurrentPage = 1;
const dsPageSize = 10;
let dsSearchQuery = "";
let dsSuggestionsTimeout = null;
let dsFavorites = [];

// Load favorites initially
chrome.storage.local.get({ dsFavorites: [] }, (data) => {
  dsFavorites = data.dsFavorites || [];
});

function saveFavoriteDataset(dataset) {
  const nameKey = dataset.name.toLowerCase().trim();
  const exists = dsFavorites.some(d => d.name.toLowerCase().trim() === nameKey);
  if (exists) {
    dsFavorites = dsFavorites.filter(d => d.name.toLowerCase().trim() !== nameKey);
  } else {
    dsFavorites.push(dataset);
  }
  chrome.storage.local.set({ dsFavorites });
}

function showDatasetPanel(show) {
  if (show) {
    githubMenuEl.style.display = "none";
    if (pdfMenuEl) pdfMenuEl.style.display = "none";
    if (smartSearchPanelEl) smartSearchPanelEl.style.display = "none";
    if (litPanelEl) {
      litPanelEl.style.display = "none";
      litDetailsModalEl.style.display = "none";
    }
    
    dsPanelEl.style.display = "flex";
    renderDsRecentSearchChips();
    if (!dsSearchQuery) {
      loadInitialDatasets();
    }
  } else {
    dsPanelEl.style.display = "none";
  }
}

async function executeDatasetSearch(query, page = 1) {
  if (!query || !query.trim()) return;
  dsSearchQuery = query;
  dsCurrentPage = page;
  
  saveDsRecentSearch(query);
  renderDsRecentSearchChips();
  
  dsResultsContainerEl.innerHTML = "";
  dsEmptyStateEl.style.display = "none";
  dsSkeletonLoaderEl.style.display = "flex";
  dsPaginationEl.style.display = "none";
  
  const { backendUrl } = await chrome.storage.sync.get("backendUrl");
  const resolvedBackend = backendUrl || "http://localhost:8000";
  
  const source = dsSourceSelectEl.value;
  const domain = dsDomainSelectEl.value;
  const task = dsTaskSelectEl.value;
  const modality = dsModalitySelectEl.value;
  const size = dsSizeSelectEl.value;
  const license = dsLicenseInputEl.value.trim();
  const sort = dsSortSelectEl.value;
  const offset = (page - 1) * dsPageSize;
  
  let url = `${resolvedBackend}/datasets/search?query=${encodeURIComponent(query)}&source=${source}&sort=${sort}&limit=${dsPageSize}&offset=${offset}`;
  if (domain) url += `&domain=${encodeURIComponent(domain)}`;
  if (task) url += `&task=${encodeURIComponent(task)}`;
  if (modality) url += `&modality=${encodeURIComponent(modality)}`;
  if (size) url += `&size=${encodeURIComponent(size)}`;
  if (license) url += `&license=${encodeURIComponent(license)}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Dataset search failed");
    const data = await res.json();
    
    dsSkeletonLoaderEl.style.display = "none";
    const results = data.results || [];
    if (results.length === 0) {
      dsEmptyStateEl.style.display = "block";
      return;
    }
    
    renderDatasetResults(results);
    
    dsPaginationEl.style.display = "flex";
    dsPageNumEl.textContent = `Page ${page}`;
    dsPrevPageBtnEl.disabled = page === 1;
    dsNextPageBtnEl.disabled = results.length < dsPageSize;
  } catch (err) {
    console.error("Dataset search error:", err);
    dsSkeletonLoaderEl.style.display = "none";
    dsResultsContainerEl.innerHTML = `<div class="popup-error" style="margin: 10px;">Error: ${err.message || String(err)}</div>`;
  }
}

async function loadInitialDatasets() {
  dsResultsContainerEl.innerHTML = "";
  dsEmptyStateEl.style.display = "none";
  dsSkeletonLoaderEl.style.display = "flex";
  dsPaginationEl.style.display = "none";
  
  const { backendUrl } = await chrome.storage.sync.get("backendUrl");
  const resolvedBackend = backendUrl || "http://localhost:8000";
  
  try {
    const res = await fetch(`${resolvedBackend}/datasets/search?query=brain+eeg&limit=10`);
    if (!res.ok) throw new Error("Initial datasets failed");
    const data = await res.json();
    
    dsSkeletonLoaderEl.style.display = "none";
    const results = data.results || [];
    if (results.length === 0) {
      dsEmptyStateEl.style.display = "block";
      return;
    }
    renderDatasetResults(results);
  } catch (err) {
    console.error("Initial datasets error:", err);
    dsSkeletonLoaderEl.style.display = "none";
    dsResultsContainerEl.innerHTML = `<div class="popup-error" style="margin: 10px;">Error: ${err.message || String(err)}</div>`;
  }
}

function renderDatasetResults(results) {
  dsResultsContainerEl.innerHTML = "";
  
  results.forEach(ds => {
    const card = document.createElement("div");
    card.className = "lit-paper-card";
    
    const formatsStr = (ds.formats || []).slice(0, 3).join(", ") || "ZIP";
    
    let sourceBadgeClass = "lit-badge-semantic";
    if (ds.source === "Kaggle") sourceBadgeClass = "lit-badge-kaggle";
    if (ds.source === "OpenML") sourceBadgeClass = "lit-badge-openalex";
    if (ds.source === "Zenodo") sourceBadgeClass = "lit-badge-openalex";
    if (ds.source === "UCI") sourceBadgeClass = "lit-badge-uci";
    if (ds.source === "Papers with Code") sourceBadgeClass = "lit-badge-paperswithcode";
    
    const isFav = dsFavorites.some(f => f.name.toLowerCase().trim() === ds.name.toLowerCase().trim());
    const favClass = isFav ? "active" : "";
    
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
        <h3 class="lit-paper-title" style="flex: 1; text-align: left;">${escapeHTML(ds.name)}</h3>
        <button class="ds-fav-btn ${favClass}" title="Save to Favorites">❤️</button>
      </div>
      <p class="lit-paper-abstract-preview" style="-webkit-line-clamp: 3; text-align: left;">${escapeHTML(ds.description || "No description available.")}</p>
      
      <div class="ds-tags-container">
        <span class="ds-tag">${escapeHTML(ds.domain)}</span>
        <span class="ds-tag">${escapeHTML(ds.modality)}</span>
        <span class="ds-tag">${escapeHTML(ds.task)}</span>
        <span class="ds-tag">${escapeHTML(ds.size)}</span>
        <span class="ds-tag">License: ${escapeHTML(ds.license)}</span>
      </div>

      <div class="ds-card-actions">
        <span style="font-size: 10px; font-weight: 600; color: var(--text-muted);">
          <span class="lit-badge ${sourceBadgeClass}">${escapeHTML(ds.source)}</span>
          <span style="margin-left: 4px;">${escapeHTML(formatsStr)}</span>
        </span>
        <div class="ds-action-btn-row">
          <button class="ds-action-btn copy-btn" title="Copy dataset link">🔗 Link</button>
          <a href="${ds.url}" target="_blank" class="ds-action-btn ds-action-btn-primary" title="Open Dataset Page">Download</a>
        </div>
      </div>
    `;
    
    const favBtn = card.querySelector(".ds-fav-btn");
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      saveFavoriteDataset(ds);
      favBtn.classList.toggle("active");
    });
    
    const copyBtn = card.querySelector(".copy-btn");
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(ds.url).then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => copyBtn.textContent = originalText, 1500);
      });
    });
    
    dsResultsContainerEl.appendChild(card);
  });
}

function saveDsRecentSearch(query) {
  if (!query || !query.trim()) return;
  chrome.storage.local.get({ dsRecentSearches: [] }, (data) => {
    let searches = data.dsRecentSearches || [];
    searches = searches.filter(s => s.toLowerCase() !== query.toLowerCase());
    searches.unshift(query);
    searches = searches.slice(0, 5);
    chrome.storage.local.set({ dsRecentSearches: searches });
  });
}

function renderDsRecentSearchChips() {
  chrome.storage.local.get({ dsRecentSearches: [] }, (data) => {
    const searches = data.dsRecentSearches || [];
    if (searches.length === 0) {
      dsRecentSearchesEl.style.display = "none";
      return;
    }
    
    dsRecentSearchesEl.style.display = "flex";
    dsRecentChipsEl.innerHTML = "";
    
    searches.forEach(search => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "lit-chip";
      chip.textContent = search;
      chip.addEventListener("click", () => {
        dsSearchInputEl.value = search;
        executeDatasetSearch(search, 1);
      });
      dsRecentChipsEl.appendChild(chip);
    });
  });
}


(async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await refreshModelBadge();
  await loadForTab(tab?.id ?? null, tab?.title, tab?.url);
  connectPort();

  // Literature Search listeners
  litSearchBtnEl.addEventListener("click", () => {
    const show = litPanelEl.style.display === "none";
    showLiteraturePanel(show);
  });
  
  closeLitBtnEl.addEventListener("click", () => {
    showLiteraturePanel(false);
  });
  
  litSearchSubmitBtnEl.addEventListener("click", () => {
    executeLiteratureSearch(litSearchInputEl.value.trim(), 1);
  });
  
  litSearchInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      executeLiteratureSearch(litSearchInputEl.value.trim(), 1);
    }
  });
  
  litToggleFiltersBtnEl.addEventListener("click", () => {
    const show = litFiltersContentEl.style.display === "none";
    litFiltersContentEl.style.display = show ? "block" : "none";
    litFiltersArrowEl.style.transform = show ? "rotate(180deg)" : "rotate(0deg)";
  });
  
  litPrevPageBtnEl.addEventListener("click", () => {
    if (litCurrentPage > 1) {
      executeLiteratureSearch(litSearchQuery, litCurrentPage - 1);
    }
  });
  
  litNextPageBtnEl.addEventListener("click", () => {
    executeLiteratureSearch(litSearchQuery, litCurrentPage + 1);
  });
  
  litCloseModalBtnEl.addEventListener("click", () => {
    litDetailsModalEl.style.display = "none";
  });
  
  litModalSimilarBtnEl.addEventListener("click", () => {
    if (litActivePaper && litActivePaper.id) {
      executeSimilarSearch(litActivePaper.id);
    }
  });
  
  litSearchInputEl.addEventListener("input", () => {
    const query = litSearchInputEl.value.trim();
    if (query.length < 3) {
      litSuggestionsEl.style.display = "none";
      return;
    }
    
    clearTimeout(litSuggestionsTimeout);
    litSuggestionsTimeout = setTimeout(async () => {
      const { backendUrl } = await chrome.storage.sync.get("backendUrl");
      const resolvedBackend = backendUrl || "http://localhost:8000";
      
      try {
        const res = await fetch(`${resolvedBackend}/literature/search?query=${encodeURIComponent(query)}&limit=5`);
        if (!res.ok) return;
        const data = await res.json();
        const results = data.results || [];
        
        if (results.length === 0) {
          litSuggestionsEl.style.display = "none";
          return;
        }
        
        litSuggestionsEl.innerHTML = "";
        results.forEach(paper => {
          const item = document.createElement("div");
          item.className = "lit-suggestion-item";
          item.textContent = paper.title;
          item.addEventListener("click", () => {
            litSearchInputEl.value = paper.title;
            litSuggestionsEl.style.display = "none";
            executeLiteratureSearch(paper.title, 1);
          });
          litSuggestionsEl.appendChild(item);
        });
        litSuggestionsEl.style.display = "block";
      } catch (e) {
        console.warn("Suggestions fetch failed", e);
      }
    }, 300);
  });
  
  document.addEventListener("click", (e) => {
    if (!litSearchInputEl.contains(e.target) && !litSuggestionsEl.contains(e.target)) {
      litSuggestionsEl.style.display = "none";
    }
  });

  // Dataset Search listeners
  dsSearchBtnEl.addEventListener("click", () => {
    const show = dsPanelEl.style.display === "none";
    showDatasetPanel(show);
  });
  
  closeDsBtnEl.addEventListener("click", () => {
    showDatasetPanel(false);
  });
  
  dsSearchSubmitBtnEl.addEventListener("click", () => {
    executeDatasetSearch(dsSearchInputEl.value.trim(), 1);
  });
  
  dsSearchInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      executeDatasetSearch(dsSearchInputEl.value.trim(), 1);
    }
  });
  
  dsToggleFiltersBtnEl.addEventListener("click", () => {
    const show = dsFiltersContentEl.style.display === "none";
    dsFiltersContentEl.style.display = show ? "block" : "none";
    dsFiltersArrowEl.style.transform = show ? "rotate(180deg)" : "rotate(0deg)";
  });
  
  dsPrevPageBtnEl.addEventListener("click", () => {
    if (dsCurrentPage > 1) {
      executeDatasetSearch(dsSearchQuery, dsCurrentPage - 1);
    }
  });
  
  dsNextPageBtnEl.addEventListener("click", () => {
    executeDatasetSearch(dsSearchQuery, dsCurrentPage + 1);
  });
  
  dsSearchInputEl.addEventListener("input", () => {
    const query = dsSearchInputEl.value.trim();
    if (query.length < 3) {
      dsSuggestionsEl.style.display = "none";
      return;
    }
    
    clearTimeout(dsSuggestionsTimeout);
    dsSuggestionsTimeout = setTimeout(async () => {
      const { backendUrl } = await chrome.storage.sync.get("backendUrl");
      const resolvedBackend = backendUrl || "http://localhost:8000";
      
      try {
        const res = await fetch(`${resolvedBackend}/datasets/search?query=${encodeURIComponent(query)}&limit=5`);
        if (!res.ok) return;
        const data = await res.json();
        const results = data.results || [];
        
        if (results.length === 0) {
          dsSuggestionsEl.style.display = "none";
          return;
        }
        
        dsSuggestionsEl.innerHTML = "";
        results.forEach(ds => {
          const item = document.createElement("div");
          item.className = "lit-suggestion-item";
          item.textContent = ds.name;
          item.addEventListener("click", () => {
            dsSearchInputEl.value = ds.name;
            dsSuggestionsEl.style.display = "none";
            executeDatasetSearch(ds.name, 1);
          });
          dsSuggestionsEl.appendChild(item);
        });
        dsSuggestionsEl.style.display = "block";
      } catch (e) {
        console.warn("Suggestions fetch failed", e);
      }
    }, 300);
  });
  
  // Features dropdown logic
  if (featuresDropdownBtn && featuresDropdownMenu) {
    featuresDropdownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = featuresDropdownMenu.style.display === "flex";
      featuresDropdownMenu.style.display = isVisible ? "none" : "flex";
    });

    document.addEventListener("click", (e) => {
      if (!featuresDropdownBtn.contains(e.target) && !featuresDropdownMenu.contains(e.target)) {
        featuresDropdownMenu.style.display = "none";
      }
    });

    dropdownSmartSearch.addEventListener("click", () => {
      featuresDropdownMenu.style.display = "none";
      if (smartSearchBtnEl) smartSearchBtnEl.click();
    });

    dropdownLiterature.addEventListener("click", () => {
      featuresDropdownMenu.style.display = "none";
      if (litSearchBtnEl) litSearchBtnEl.click();
    });

    dropdownDatasets.addEventListener("click", () => {
      featuresDropdownMenu.style.display = "none";
      if (dsSearchBtnEl) dsSearchBtnEl.click();
    });

    dropdownPdf.addEventListener("click", () => {
      featuresDropdownMenu.style.display = "none";
      if (pdfModeBtnEl) pdfModeBtnEl.click();
    });

    dropdownGithub.addEventListener("click", () => {
      if (!dropdownGithub.classList.contains("disabled")) {
        featuresDropdownMenu.style.display = "none";
        if (githubModeBtnEl) githubModeBtnEl.click();
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (!dsSearchInputEl.contains(e.target) && !dsSuggestionsEl.contains(e.target)) {
      dsSuggestionsEl.style.display = "none";
    }
  });

  // ─── Chat History Panel Logic ──────────────────────────────────────────────────
  const dropdownHistoryEl = document.getElementById("dropdownHistory");
  const historyPanelEl = document.getElementById("historyPanel");
  const closeHistoryBtnEl = document.getElementById("closeHistoryPanelBtn");
  const historySearchInputEl = document.getElementById("historySearchInput");
  const historySkeletonLoaderEl = document.getElementById("historySkeletonLoader");
  const historyEmptyStateEl = document.getElementById("historyEmptyState");
  const historyListContainerEl = document.getElementById("historyListContainer");

  let allHistoryItems = []; // caches retrieved items to support client-side filtering

  if (dropdownHistoryEl && historyPanelEl) {
    dropdownHistoryEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (userDropdownMenuEl) userDropdownMenuEl.style.display = "none";
      
      // Close other panels
      const litPanel = document.getElementById("literatureSearchPanel");
      const dsPanel = document.getElementById("datasetSearchPanel");
      const ghPanel = document.getElementById("githubPanel");
      if (litPanel) litPanel.style.display = "none";
      if (dsPanel) dsPanel.style.display = "none";
      if (ghPanel) ghPanel.style.display = "none";

      historyPanelEl.style.display = "flex";
      loadServerHistory();
    });
  }

  if (closeHistoryBtnEl && historyPanelEl) {
    closeHistoryBtnEl.addEventListener("click", () => {
      historyPanelEl.style.display = "none";
    });
  }

  if (historySearchInputEl) {
    historySearchInputEl.addEventListener("input", () => {
      filterAndRenderHistory();
    });
  }

  async function loadServerHistory() {
    if (!historyListContainerEl) return;
    
    // Reset view
    historyListContainerEl.innerHTML = "";
    if (historyEmptyStateEl) historyEmptyStateEl.style.display = "none";
    if (historySkeletonLoaderEl) historySkeletonLoaderEl.style.display = "flex";
    if (historySearchInputEl) historySearchInputEl.value = "";

    try {
      const backendUrl = await getBackendUrl();
      const headers = {};
      const { authToken: token } = await chrome.storage.local.get("authToken");
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(`${backendUrl}/chat/history`, {
        method: "GET",
        headers: headers
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      allHistoryItems = data.history || [];
      filterAndRenderHistory();
    } catch (err) {
      console.error("Failed to load chat history:", err);
      if (historyEmptyStateEl) {
        historyEmptyStateEl.querySelector("p").textContent = "Failed to load history";
        historyEmptyStateEl.querySelector("span").textContent = err.message || "Please check server status.";
        historyEmptyStateEl.style.display = "block";
      }
    } finally {
      if (historySkeletonLoaderEl) historySkeletonLoaderEl.style.display = "none";
    }
  }

  function filterAndRenderHistory() {
    if (!historyListContainerEl) return;
    historyListContainerEl.innerHTML = "";

    const query = (historySearchInputEl?.value || "").toLowerCase().trim();
    const filtered = allHistoryItems.filter(item => {
      return (item.title || "").toLowerCase().includes(query) ||
             (item.url || "").toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      if (historyEmptyStateEl) {
        historyEmptyStateEl.querySelector("p").textContent = "No history found";
        historyEmptyStateEl.querySelector("span").textContent = query ? "Try adjusting your filter search query." : "You haven't saved any chats yet.";
        historyEmptyStateEl.style.display = "block";
      }
      return;
    }

    if (historyEmptyStateEl) historyEmptyStateEl.style.display = "none";

    for (const item of filtered) {
      const card = document.createElement("div");
      card.className = "history-card";
      
      const titleText = item.title || item.url;
      const turnCount = item.messages ? Math.floor(item.messages.length / 2) : 0;
      const relativeTime = formatRelativeTime(new Date(item.updated_at));

      card.innerHTML = `
        <div class="history-card-title" title="${escapeHTML(titleText)}">${escapeHTML(titleText)}</div>
        <div class="history-card-url" title="${escapeHTML(item.url)}">${escapeHTML(item.url)}</div>
        <div class="history-card-meta">
          <span class="history-card-badge">${turnCount} turn${turnCount === 1 ? "" : "s"}</span>
          <span>•</span>
          <span>${relativeTime}</span>
        </div>
        <button type="button" class="history-delete-btn" title="Delete conversation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>
          </svg>
        </button>
      `;

      // Click card to restore chat
      card.addEventListener("click", async (e) => {
        if (e.target.closest(".history-delete-btn")) return;
        
        historyPanelEl.style.display = "none";
        await restoreConversation(item.url, item.messages);
      });

      // Click delete button
      const deleteBtn = card.querySelector(".history-delete-btn");
      if (deleteBtn) {
        deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (confirm(`Delete history for "${titleText}"?`)) {
            card.style.opacity = "0.5";
            card.style.pointerEvents = "none";
            await deleteServerHistory(item.url);
          }
        });
      }

      historyListContainerEl.appendChild(card);
    }
  }

  async function restoreConversation(url, messages) {
    const HISTORY_PREFIX = "history_";
    const HISTORY_INDEX_KEY = "historyIndex";
    const MAX_STORED_PAGES = 50;

    const normalized = url.toLowerCase().trim().replace(/\/+$/, "");
    const key = HISTORY_PREFIX + normalized;

    // 1. Save turns to chrome.storage.local
    await chrome.storage.local.set({ [key]: messages });

    // 2. Add to historyIndex
    const { [HISTORY_INDEX_KEY]: index = [] } = await chrome.storage.local.get(HISTORY_INDEX_KEY);
    const next = [normalized, ...index.filter((u) => u !== normalized)];
    const kept = next.slice(0, MAX_STORED_PAGES);
    await chrome.storage.local.set({ [HISTORY_INDEX_KEY]: kept });

    // 3. Re-run loadForTab if restored conversation matches the current active tab
    const activeTab = await getActiveTab();
    if (activeTab && activeTab.url && activeTab.url.toLowerCase().trim().replace(/\/+$/, "") === normalized) {
      const messagesEl = document.getElementById("messages");
      if (messagesEl) {
        messagesEl.innerHTML = "";
        if (typeof loadForTab === "function") {
          loadForTab();
        } else {
          window.location.reload();
        }
      }
    } else {
      alert(`Conversation loaded! Revisit that page to continue chatting.`);
    }
  }

  async function deleteServerHistory(url) {
    const HISTORY_PREFIX = "history_";
    const HISTORY_INDEX_KEY = "historyIndex";

    try {
      const backendUrl = await getBackendUrl();
      const headers = {};
      const { authToken: token } = await chrome.storage.local.get("authToken");
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(`${backendUrl}/chat/history?url=${encodeURIComponent(url)}`, {
        method: "DELETE",
        headers: headers
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Delete locally
      const normalized = url.toLowerCase().trim().replace(/\/+$/, "");
      const key = HISTORY_PREFIX + normalized;
      await chrome.storage.local.remove(key);

      const { [HISTORY_INDEX_KEY]: index = [] } = await chrome.storage.local.get(HISTORY_INDEX_KEY);
      const updatedIndex = index.filter(u => u !== normalized);
      await chrome.storage.local.set({ [HISTORY_INDEX_KEY]: updatedIndex });

      // Refresh list
      allHistoryItems = allHistoryItems.filter(item => item.url !== url);
      filterAndRenderHistory();
    } catch (err) {
      console.error("Failed to delete history:", err);
      alert(`Could not delete conversation: ${err.message}`);
      loadServerHistory();
    }
  }

  function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs.length > 0 ? tabs[0] : null;
  }
})();


