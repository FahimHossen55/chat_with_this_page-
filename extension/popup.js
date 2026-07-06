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

// ─── YouTube / PDF / Smart Search Elements ───────────────────────────────────
const youtubeModeBtn   = document.getElementById("youtubeModeBtn");
const youtubeMenuEl    = document.getElementById("youtubeMenu");
const closeYoutubeBtn  = document.getElementById("closeYoutubeMenuBtn");
const youtubeActionsGridEl = document.getElementById("youtubeActionsGrid");

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

function isYouTubeUrl(urlStr) {
  if (!urlStr) return false;
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be") return url.pathname.length > 1;
    if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
      return url.searchParams.has("v");
    }
    return false;
  } catch { return false; }
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
      const fileParam = url.searchParams.get("file");
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

// getPdfText() tags each page's extracted text with "--- Page N ---", so
// finding which page a snippet came from is just locating which page-chunk
// contains it (whitespace-insensitively, since pdf.js's item-joined text
// doesn't always match the LLM's returned wording byte-for-byte).
function findPdfPageForSnippet(pageContent, snippet) {
  const needle = normalizeForSearch(snippet).slice(0, 80);
  if (!needle) return null;
  const chunks = pageContent.split(/--- Page (\d+) ---/);
  // String#split with a capturing group interleaves the results:
  // ["", "1", "<page 1 text>", "2", "<page 2 text>", ...]
  for (let i = 1; i < chunks.length; i += 2) {
    const pageNum = parseInt(chunks[i], 10);
    const text = chunks[i + 1] || "";
    if (normalizeForSearch(text).includes(needle)) return pageNum;
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

// ─── YouTube Actions ──────────────────────────────────────────────────────────
const YOUTUBE_ACTIONS = [
  { id: "summarize-video",    label: "Summarize video",      icon: "📋" },
  { id: "generate-notes",     label: "Generate notes",       icon: "📝" },
  { id: "generate-quiz",      label: "Generate quiz",        icon: "❓" },
  { id: "extract-timestamps", label: "Extract timestamps",   icon: "⏱️" },
  { id: "find-moments",       label: "Find key moments",     icon: "💡" },
  { id: "explain-code",       label: "Explain code shown",   icon: "💻" },
];

// ─── PDF Actions ──────────────────────────────────────────────────────────────
const PDF_ACTIONS = [
  { id: "summarize-pdf",      label: "Summarize PDF",        icon: "📋" },
  { id: "search-pdf",         label: "Search PDF",           icon: "🔍" },
  { id: "explain-equations",  label: "Explain equations",    icon: "🔬" },
  { id: "flashcards",         label: "Generate flashcards",  icon: "🃏" },
  { id: "extract-tables",     label: "Extract tables",       icon: "📊" },
  { id: "citation",           label: "Citation & Reference",  icon: "📚" },
];

// ─── YouTube Transcript Fetching ─────────────────────────────────────────────
function parseTranscriptXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");
  const textNodes = doc.getElementsByTagName("text");
  const lines = [];
  for (let i = 0; i < textNodes.length; i++) {
    const node = textNodes[i];
    const text = node.textContent
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    if (!text) continue;
    const startSec = Math.floor(parseFloat(node.getAttribute("start") || "0"));
    const mm = Math.floor(startSec / 60);
    const ss = startSec % 60;
    lines.push({ time: startSec * 1000, timestamp: `[${mm}:${ss.toString().padStart(2,"0")}]`, text });
  }
  return lines;
}

async function getYouTubeTranscript(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const player = document.getElementById("movie_player");
        let playerResponse = null;
        if (player && typeof player.getPlayerResponse === "function") {
          playerResponse = player.getPlayerResponse();
        } else {
          const watchFlexy = document.querySelector("ytd-watch-flexy");
          if (watchFlexy && watchFlexy.playerData) {
            playerResponse = watchFlexy.playerData;
          } else {
            playerResponse = window.ytInitialPlayerResponse || null;
          }
        }
        const captionTracks =
          playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;

        // Also grab what's needed to call the same private "get_transcript"
        // API that YouTube's own "Show transcript" button uses. The legacy
        // /api/timedtext URLs in captionTracks[].baseUrl below increasingly
        // come back as HTTP 200 with a zero-byte body — Google tightened
        // anti-scraping on that endpoint and it now typically requires a
        // session-bound Proof-of-Origin token a plain fetch doesn't have.
        // This endpoint is what the real transcript panel depends on, so
        // it's far less likely to be silently blocked.
        let innertube = null;
        try {
          const apiKey = window.ytcfg?.get?.("INNERTUBE_API_KEY");
          const context = window.ytcfg?.get?.("INNERTUBE_CONTEXT");
          const panels = window.ytInitialData?.engagementPanels || [];
          const panel = panels.find(
            (p) =>
              p?.engagementPanelSectionListRenderer?.panelIdentifier ===
              "engagement-panel-searchable-transcript"
          );
          const params =
            panel?.engagementPanelSectionListRenderer?.content?.continuationItemRenderer
              ?.continuationEndpoint?.getTranscriptEndpoint?.params;
          if (apiKey && context && params) innertube = { apiKey, context, params };
        } catch {}

        const videoId =
          playerResponse?.videoDetails?.videoId ||
          new URL(location.href).searchParams.get("v") ||
          null;

        return { captionTracks, innertube, videoId };
      }
    });

    const { captionTracks, innertube, videoId } = result?.result || {};

    // Inject content script first so messaging works even after extension reload
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });

    // Attempt 1: YouTube's own get_transcript API, using whatever's already
    // sitting in the live page's window.ytInitialData/ytcfg (fastest, no
    // extra network round trip).
    let innertubeError = null;
    if (innertube) {
      const viaApi = await chrome.tabs.sendMessage(tabId, {
        type: "FETCH_YOUTUBE_TRANSCRIPT_V2",
        ...innertube,
      });
      if (viaApi?.lines?.length) return viaApi.lines;
      innertubeError = viaApi?.error || "empty response";
    }

    // Attempt 2: same API, but sourced from a fresh fetch of the watch page's
    // own HTML instead of live in-page globals — YouTube's SPA navigation can
    // leave window.ytInitialData stale or missing the transcript panel's
    // continuation params for whatever video is *currently* loaded, which
    // attempt 1 has no way to detect (it just looks empty/absent).
    let watchPageError = null;
    if (videoId) {
      const viaHtml = await chrome.tabs.sendMessage(tabId, {
        type: "FETCH_YOUTUBE_TRANSCRIPT_V3",
        videoId,
      });
      if (viaHtml?.lines?.length) return viaHtml.lines;
      watchPageError = viaHtml?.error || "empty response";
    }

    // Attempt 3: legacy caption-track XML.
    if (!captionTracks || captionTracks.length === 0) {
      throw new Error("No captions or transcripts available for this video.");
    }
    let track = captionTracks.find(t => t.languageCode === "en") || captionTracks[0];
    if (!track || !track.baseUrl) throw new Error("No transcript URL found.");

    const fetchRes = await chrome.tabs.sendMessage(tabId, {
      type: "FETCH_YOUTUBE_TRANSCRIPT",
      url: track.baseUrl
    });

    if (!fetchRes) throw new Error("Failed to communicate with YouTube page content script.");
    if (fetchRes.error || !fetchRes.xmlText) {
      const detail = fetchRes.error || "empty response";
      const attempts = [
        innertubeError && `live-page API: ${innertubeError}`,
        watchPageError && `watch-page API: ${watchPageError}`,
      ].filter(Boolean).join("; ");
      throw new Error(
        `${detail}${attempts ? ` (also tried — ${attempts})` : ""} — YouTube is likely ` +
        `throttling/blocking transcript requests for this video right now. Confirm captions ` +
        `exist via the video's own CC/"Show transcript" button, then try again in a moment.`
      );
    }

    const lines = parseTranscriptXml(fetchRes.xmlText);
    if (lines.length === 0) throw new Error("Transcript XML contained no text nodes.");
    return lines;
  } catch (err) {
    throw new Error("YouTube Transcript Error: " + err.message);
  }
}

// ─── PDF Text Extraction ──────────────────────────────────────────────────────
async function getPdfText(pdfUrl) {
  try {
    if (pdfUrl.startsWith("file://")) {
      try { await fetch(pdfUrl); } catch {
        throw new Error("Cannot access local file. Go to chrome://extensions → Chat With This Page → Details → enable 'Allow access to file URLs'.");
      }
    }
    if (typeof pdfjsLib === "undefined") {
      throw new Error("PDF.js library not loaded. Try reloading the extension.");
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";

    const targetUrl = resolvePdfTargetUrl(pdfUrl);

    const loadingTask = pdfjsLib.getDocument(targetUrl);
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

// ─── YouTube Action Handler ───────────────────────────────────────────────────
async function handleYouTubeAction(actionId) {
  youtubeMenuEl.style.display = "none";

  let pdfUrlInput = null;
  if (!isYouTubeUrl(activeTabUrl)) {
    pdfUrlInput = prompt("YouTube Mode is active, but this page is not a YouTube video.\nEnter a YouTube video URL:", "https://www.youtube.com/watch?v=");
    if (!pdfUrlInput) return;
  }

  const statusMsg = addMessage("user", `⏳ Loading YouTube transcript…`);
  let transcript;
  try {
    transcript = await getYouTubeTranscript(activeTabId);
  } catch (err) {
    statusMsg.remove();
    addMessage("error", err.message);
    setSending(false);
    return;
  }
  statusMsg.remove();

  const transcriptText = transcript.map(l => `${l.timestamp} ${l.text}`).join("\n");
  const contextText = `[YouTube Video Transcript]\n${transcriptText}`;

  const prompts = {
    "summarize-video":    "Summarize this YouTube video in detail. Cover the main points, arguments, and conclusions.",
    "generate-notes":     "Generate comprehensive study notes from this YouTube video transcript. Use headings, bullet points and key terms.",
    "generate-quiz":      "Generate a 10-question quiz based on this YouTube video. Include multiple-choice and short-answer questions with answers.",
    "extract-timestamps": "Extract the most important timestamps from this transcript. For each timestamp provide the time and a brief description of what's discussed.",
    "find-moments":       "Identify the 5-10 most important and insightful moments in this video. Explain why each is significant.",
    "explain-code":       "Identify and explain any code, algorithms, or technical concepts shown or discussed in this video transcript.",
  };

  const question = prompts[actionId] || "Analyze this YouTube video transcript.";
  streamModeQuestion(question, contextText);
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

  const contextText = `[PDF Document — ${pdfData.pagesCount} pages]\n${pdfData.text}`;

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

    let scrollResult = null;
    let jumpedToPage = null;

    if (isPdfUrl(activeTabUrl)) {
      // Can't inject a content script into a PDF viewer tab (native or a
      // third-party extension's) to scroll/highlight, but every mainstream
      // viewer honors the "#page=N" fragment convention — so jump the whole
      // tab there instead. pageContent already carries "--- Page N ---"
      // markers from getPdfText(), so we just need to find which page-chunk
      // contains the snippet.
      const pageNum = findPdfPageForSnippet(pageContent, snippet);
      if (pageNum) {
        try {
          await chrome.tabs.update(activeTabId, { url: withPageFragment(activeTabUrl, pageNum) });
          jumpedToPage = pageNum;
        } catch {
          jumpedToPage = null;
        }
      }
    } else if (isScriptableTabUrl(activeTabUrl)) {
      // Scroll & highlight in the active tab. Page text nodes can contain
      // whatever raw whitespace/line-breaks the source HTML used, which
      // won't match the single-spaced snippet the LLM returned unless both
      // sides are normalized the same way first.
      try {
        [scrollResult] = await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: (targetText) => {
            const normalize = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
            const needle = normalize(targetText).slice(0, 60);
            if (!needle) return false;
            const walker = document.createTreeWalker(
              document.body, NodeFilter.SHOW_TEXT, null
            );
            let node;
            while ((node = walker.nextNode())) {
              if (normalize(node.nodeValue).includes(needle)) {
                const el = node.parentElement;
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  const orig = el.style.cssText;
                  el.style.transition = "background 0.3s";
                  el.style.background = "#fef08a";
                  setTimeout(() => { el.style.cssText = orig; }, 2500);
                  return true;
                }
              }
            }
            return false;
          },
          args: [snippet]
        });
      } catch {
        scrollResult = null;
      }
    }

    const shortSnippet = `"${snippet.slice(0, 100)}${snippet.length > 100 ? '…' : ''}"`;
    smartSearchStatusEl.textContent = scrollResult?.result
      ? `Found: ${shortSnippet} — scrolled there.`
      : jumpedToPage
        ? `Found: ${shortSnippet} — jumped to page ${jumpedToPage}.`
        : isPdfUrl(activeTabUrl)
          ? `Found: ${shortSnippet} (couldn't determine which page it's on).`
          : `Found: ${shortSnippet} — but couldn't locate it on the page to scroll to (it may be on a part of the page that hasn't rendered, e.g. behind a "load more" or a different tab/section).`;

  } catch (err) {
    smartSearchStatusEl.textContent = `Error: ${err.message}`;
  } finally {
    smartSearchSubmitBtnEl.disabled = false;
  }
}

// ─── YouTube Menu Listeners ───────────────────────────────────────────────────
if (youtubeModeBtn) {
  youtubeModeBtn.addEventListener("click", () => {
    const open = youtubeMenuEl.style.display !== "none" && youtubeMenuEl.style.display !== "";
    if (open) {
      youtubeMenuEl.style.display = "none";
    } else {
      // Populate action grid
      youtubeActionsGridEl.innerHTML = "";
      YOUTUBE_ACTIONS.forEach(action => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "github-action-card";
        btn.innerHTML = `<span class="action-icon">${action.icon}</span><span class="action-label">${action.label}</span>`;
        btn.addEventListener("click", () => handleYouTubeAction(action.id));
        youtubeActionsGridEl.appendChild(btn);
      });
      // Close other menus
      githubMenuEl.style.display = "none";
      pdfMenuEl.style.display = "none";
      smartSearchPanelEl.style.display = "none";
      youtubeMenuEl.style.display = "flex";
    }
  });
}
if (closeYoutubeBtn) {
  closeYoutubeBtn.addEventListener("click", () => { youtubeMenuEl.style.display = "none"; });
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
      youtubeMenuEl.style.display = "none";
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
      youtubeMenuEl.style.display = "none";
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
  githubMenuEl.style.display = "none";
  if (youtubeMenuEl) youtubeMenuEl.style.display = "none";
  if (pdfMenuEl) pdfMenuEl.style.display = "none";
  if (smartSearchPanelEl) smartSearchPanelEl.style.display = "none";

  // GitHub button — only on GitHub pages
  const gitContext = parseGitHubUrl(tabUrl);
  githubModeBtnEl.style.display = gitContext ? "inline-flex" : "none";

  // YouTube button — always visible so you can load a YouTube URL manually
  if (youtubeModeBtn) youtubeModeBtn.style.display = "inline-flex";
  // PDF button — always visible so you can paste a PDF URL manually
  if (pdfModeBtnEl) pdfModeBtnEl.style.display = "inline-flex";
  // Smart Search — always visible
  if (smartSearchBtnEl) smartSearchBtnEl.style.display = "inline-flex";

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
