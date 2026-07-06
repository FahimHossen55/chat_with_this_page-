// Injected on demand into the active tab to extract readable page text.
// Runs only when the user opens the popup (activeTab permission), not on every page load.

// This file is (re-)injected via chrome.scripting.executeScript on every
// PDF/YouTube/Smart-Search/chat action, so guard against registering the
// onMessage listener more than once per tab.
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

  // Fetches a YouTube caption track's XML from inside the page's own origin
  // (popup.js can't fetch it directly — youtube.com isn't its origin and the
  // baseUrl is session/cookie-bound), then hands the raw XML back to popup.js
  // for parsing.
  async function fetchYouTubeTranscript(url) {
    if (!url) return { error: "No transcript URL provided." };
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) return { error: `HTTP ${res.status} ${res.statusText}` };
      const xmlText = await res.text();
      if (!xmlText) return { error: "Empty transcript response." };
      return { xmlText };
    } catch (err) {
      return { error: err?.message || String(err) };
    }
  }

  // Calls the same private "get_transcript" Innertube API that YouTube's own
  // "Show transcript" button uses, given the {apiKey, context, params} pulled
  // out of the page's ytcfg/ytInitialData by popup.js's MAIN-world script.
  // Preferred over fetchYouTubeTranscript() above since the legacy timedtext
  // endpoint it hits has become unreliable (see comment there).
  async function fetchYouTubeTranscriptViaInnertube({ apiKey, context, params }) {
    if (!apiKey || !context || !params) {
      return { error: "Missing get_transcript request data." };
    }
    try {
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/get_transcript?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context, params }),
        }
      );
      if (!res.ok) return { error: `HTTP ${res.status} ${res.statusText}` };
      const data = await res.json();

      const transcriptContent = data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content;
      const segments =
        transcriptContent?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments ||
        transcriptContent?.transcriptSegmentListRenderer?.initialSegments ||
        [];

      const lines = [];
      for (const seg of segments) {
        const renderer = seg?.transcriptSegmentRenderer;
        if (!renderer) continue;
        const text = (
          renderer.snippet?.runs?.map((r) => r.text).join("") ||
          renderer.snippet?.simpleText ||
          ""
        ).trim();
        if (!text) continue;
        const startMs = Number(renderer.startMs || 0);
        const startSec = Math.floor(startMs / 1000);
        const mm = Math.floor(startSec / 60);
        const ss = startSec % 60;
        lines.push({ time: startMs, timestamp: `[${mm}:${ss.toString().padStart(2, "0")}]`, text });
      }

      if (lines.length === 0) return { error: "No transcript segments in API response." };
      return { lines };
    } catch (err) {
      return { error: err?.message || String(err) };
    }
  }

  // YouTube's SPA navigation means window.ytInitialData/ytcfg (read by
  // popup.js's MAIN-world script) can be stale or simply not carry the
  // transcript panel's continuation params yet for whatever video is
  // *currently* loaded. Sidestep that entirely by fetching the canonical
  // watch page HTML fresh, scoped to this exact video ID, and pulling the
  // API key/context/params straight out of that response instead of out of
  // live in-page state.
  async function fetchYouTubeTranscriptViaWatchPage(videoId) {
    if (!videoId) return { error: "No video ID available." };
    try {
      const res = await fetch(
        `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) return { error: `HTTP ${res.status} fetching watch page` };
      const html = await res.text();

      const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
      if (!apiKeyMatch) return { error: "Could not find API key in watch page." };
      const apiKey = apiKeyMatch[1];

      let context = null;
      const contextMatch = html.match(/"INNERTUBE_CONTEXT":(\{.*?\}),"INNERTUBE_CONTEXT_CLIENT_NAME"/s);
      if (contextMatch) {
        try { context = JSON.parse(contextMatch[1]); } catch {}
      }
      if (!context) {
        // Bare WEB client context YouTube also accepts, in case the exact
        // embedded context couldn't be parsed out of the page above.
        context = { client: { clientName: "WEB", clientVersion: "2.20240101.00.00" } };
      }

      const panelsMatch = html.match(
        /"panelIdentifier":"engagement-panel-searchable-transcript"[\s\S]*?"getTranscriptEndpoint":\{"params":"([^"]+)"/
      );
      if (!panelsMatch) {
        return { error: "Could not find transcript params in watch page (this video may have no transcript)." };
      }

      return fetchYouTubeTranscriptViaInnertube({ apiKey, context, params: panelsMatch[1] });
    } catch (err) {
      return { error: err?.message || String(err) };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "EXTRACT_PAGE_TEXT") {
      sendResponse(extractPageText());
      return true;
    }
    if (message?.type === "FETCH_YOUTUBE_TRANSCRIPT") {
      fetchYouTubeTranscript(message.url).then(sendResponse);
      return true; // keep the message channel open for the async fetch above
    }
    if (message?.type === "FETCH_YOUTUBE_TRANSCRIPT_V2") {
      fetchYouTubeTranscriptViaInnertube(message).then(sendResponse);
      return true;
    }
    if (message?.type === "FETCH_YOUTUBE_TRANSCRIPT_V3") {
      fetchYouTubeTranscriptViaWatchPage(message.videoId).then(sendResponse);
      return true;
    }
    return true;
  });
}
