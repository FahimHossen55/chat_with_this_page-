(function () {
  // Prevent duplicate injection
  if (window.__chatWithThisPageAssistantLoaded) return;
  window.__chatWithThisPageAssistantLoaded = true;

  // Global variables inside scope
  let activeSelectionText = "";
  let activeSelectionContext = "";
  let selectionCoords = null;
  let activePort = null;
  let currentSpeechUtterance = null;
  let isSpeaking = false;

  // Create Root element for Shadow DOM
  const rootContainer = document.createElement("div");
  rootContainer.id = "chat-with-page-assistant-root";
  rootContainer.style.position = "absolute";
  rootContainer.style.top = "0";
  rootContainer.style.left = "0";
  rootContainer.style.width = "100%";
  rootContainer.style.height = "0";
  rootContainer.style.overflow = "visible";
  rootContainer.style.zIndex = "2147483647";
  
  const targetContainer = document.body || document.documentElement;
  if (targetContainer) {
    targetContainer.appendChild(rootContainer);
  }

  const shadow = rootContainer.attachShadow({ mode: "open" });

  // Inject assistant.css stylesheet into Shadow DOM via fetch to bypass host CSP rules
  const cssUrl = chrome.runtime.getURL("assistant.css");
  fetch(cssUrl)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.text();
    })
    .then(css => {
      const style = document.createElement("style");
      style.textContent = css;
      shadow.appendChild(style);
    })
    .catch(err => {
      console.warn("Failed to load assistant styles via fetch, falling back to link element:", err);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssUrl;
      shadow.appendChild(link);
    });

  // UI state holders
  let toolbarEl = null;
  let popupEl = null;

  // Language maps for Text-to-Speech (Web Speech API voices)
  const LANGUAGE_VOICES = {
    "en": "en-US",
    "es": "es-ES",
    "bn": "bn-BD",
    "fr": "fr-FR",
    "de": "de-DE",
    "zh": "zh-CN",
    "ar": "ar-SA",
    "hi": "hi-IN",
    "ja": "ja-JP",
    "ko": "ko-KR",
    "ru": "ru-RU",
    "pt": "pt-PT"
  };

  // Safe markdown to HTML formatter (prevents XSS and supports basic styles)
  function formatMarkdown(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/`(.*?)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  }

  // Clear existing UI elements
  function removeToolbar() {
    if (toolbarEl) {
      toolbarEl.remove();
      toolbarEl = null;
    }
  }

  function removePopup() {
    if (popupEl) {
      stopSpeech();
      if (activePort) {
        activePort.disconnect();
        activePort = null;
      }
      popupEl.remove();
      popupEl = null;
    }
  }

  // Calculate coordinates to position element relative to selection
  function getPlacementPosition(coords, elementWidth, elementHeight, spacing = 8) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

    // Default: try placing directly above selection
    let top = coords.top + scrollTop - elementHeight - spacing;
    let left = coords.left + scrollLeft + (coords.width - elementWidth) / 2;

    // Check if it overflows top of page -> place below instead
    if (coords.top - elementHeight - spacing < 10) {
      top = coords.bottom + scrollTop + spacing;
    }

    // Horizontal bounds checks
    if (left < 10) {
      left = 10;
    } else if (left + elementWidth > viewportWidth - 10) {
      left = viewportWidth - elementWidth - 10;
    }

    return { top, left };
  }

  // Retrieve surrounding context paragraph text
  function getSurroundingContext(range) {
    try {
      let node = range.startContainer;
      // Walk up to find block parent container
      while (node && node !== document.body) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const style = window.getComputedStyle(node);
          const display = style.display;
          if (display === "block" || display === "flex" || display === "grid" || display === "list-item" || node.tagName === "P" || node.tagName === "DIV") {
            break;
          }
        }
        node = node.parentNode;
      }
      if (node && node.innerText) {
        const text = node.innerText.trim();
        if (text.length > 50) {
          return text.slice(0, 1200);
        }
      }
    } catch (e) {
      console.error("Context extraction failed", e);
    }
    return "";
  }

  // Watch for text selection
  let selectionTimeout = null;
  document.addEventListener("mouseup", (e) => {
    // Ignore clicks inside the assistant container
    if (rootContainer.contains(e.target)) return;

    clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(handleSelectionChange, 80);
  });

  document.addEventListener("keyup", (e) => {
    // Ignore keyups inside the assistant container
    if (rootContainer.contains(e.target)) return;

    clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(handleSelectionChange, 80);
  });

  // Handle document click to close UI if clicking elsewhere
  document.addEventListener("mousedown", (e) => {
    if (rootContainer.contains(e.target)) return;
    
    // If clicking outside, clear everything
    removeToolbar();
    removePopup();
  });

  function handleSelectionChange() {
    const sel = window.getSelection();
    const text = sel.toString().trim();

    if (!text) {
      // Clear toolbar if selection is cleared (and no active popup is shown)
      if (!popupEl) {
        removeToolbar();
      }
      return;
    }

    // Keep active selection references
    activeSelectionText = text;
    if (sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    activeSelectionContext = getSurroundingContext(range);
    
    const rect = range.getBoundingClientRect();
    selectionCoords = {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
      width: rect.width,
      height: rect.height
    };

    // Show toolbar if no active popup is displayed
    if (!popupEl) {
      showToolbar();
    }
  }

  // ---------- Render Toolbar ----------
  function showToolbar() {
    removeToolbar();

    toolbarEl = document.createElement("div");
    toolbarEl.className = "assistant-ui assistant-toolbar";

    const actions = [
      { id: "explain", label: "✨ Explain" },
      { id: "translate", label: "🌐 Translate" },
      { id: "summarize", label: "📝 Summarize" },
      { id: "ask", label: "❓ Ask AI" }
    ];

    actions.forEach((act, index) => {
      if (index > 0) {
        const div = document.createElement("div");
        div.className = "toolbar-divider";
        toolbarEl.appendChild(div);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toolbar-btn";
      btn.textContent = act.label;
      btn.addEventListener("click", () => handleToolbarAction(act.id));
      toolbarEl.appendChild(btn);
    });

    shadow.appendChild(toolbarEl);

    // Position the toolbar
    const { top, left } = getPlacementPosition(selectionCoords, toolbarEl.offsetWidth || 300, toolbarEl.offsetHeight || 38, 8);
    toolbarEl.style.top = `${top}px`;
    toolbarEl.style.left = `${left}px`;
  }

  function handleToolbarAction(actionId) {
    removeToolbar();
    showPopup(actionId);
  }

  // ---------- Render Popup ----------
  function showPopup(initialActionId) {
    removePopup();

    popupEl = document.createElement("div");
    popupEl.className = "assistant-ui assistant-popup";

    // Build Header
    const header = document.createElement("div");
    header.className = "popup-header";

    const title = document.createElement("div");
    title.className = "popup-title";
    title.innerHTML = `<span>🤖 Selected Text Assistant</span>`;
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "popup-close-btn";
    closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    closeBtn.addEventListener("click", removePopup);
    header.appendChild(closeBtn);

    popupEl.appendChild(header);

    // Build Subheader (Mode Selectors)
    const subheader = document.createElement("div");
    subheader.className = "popup-subheader";
    subheader.style.display = "none";
    popupEl.appendChild(subheader);

    // Build Body
    const body = document.createElement("div");
    body.className = "popup-body";
    popupEl.appendChild(body);

    // Build Footer
    const footer = document.createElement("div");
    footer.className = "popup-footer";

    const footerActs = document.createElement("div");
    footerActs.className = "footer-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "footer-btn";
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span>`;
    copyBtn.addEventListener("click", () => {
      const textToCopy = body.textContent || "";
      navigator.clipboard.writeText(textToCopy);
      copyBtn.querySelector("span").textContent = "Copied ✓";
      copyBtn.classList.add("active");
      setTimeout(() => {
        copyBtn.querySelector("span").textContent = "Copy";
        copyBtn.classList.remove("active");
      }, 1200);
    });
    footerActs.appendChild(copyBtn);

    const speakBtn = document.createElement("button");
    speakBtn.type = "button";
    speakBtn.className = "footer-btn";
    speakBtn.style.display = "none"; // configured dynamically
    speakBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg><span>Speak</span>`;
    speakBtn.addEventListener("click", () => {
      if (isSpeaking) {
        stopSpeech();
      } else {
        const textToSpeak = body.textContent || "";
        const langCode = speakBtn.dataset.lang || "en";
        startSpeech(textToSpeak, langCode);
      }
    });
    footerActs.appendChild(speakBtn);

    footer.appendChild(footerActs);
    popupEl.appendChild(footer);

    // Build Ask AI Input
    const askContainer = document.createElement("div");
    askContainer.className = "popup-ask-container";

    const askInput = document.createElement("input");
    askInput.type = "text";
    askInput.className = "popup-ask-input";
    askInput.placeholder = "Ask AI about this selection...";
    askInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = askInput.value.trim();
        if (val) triggerAskAI(val);
      }
    });
    askContainer.appendChild(askInput);

    const askSubmit = document.createElement("button");
    askSubmit.type = "button";
    askSubmit.className = "popup-ask-submit";
    askSubmit.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
    askSubmit.addEventListener("click", () => {
      const val = askInput.value.trim();
      if (val) triggerAskAI(val);
    });
    askContainer.appendChild(askSubmit);

    popupEl.appendChild(askContainer);

    // Append to shadow DOM first so offsets load
    shadow.appendChild(popupEl);

    // Position the popup
    const { top, left } = getPlacementPosition(selectionCoords, 320, 240, 8);
    popupEl.style.top = `${top}px`;
    popupEl.style.left = `${left}px`;

    // Initialize the chosen action
    runAction(initialActionId);
  }

  // ---------- Action Controllers ----------

  async function runAction(actionId, extraOptions = {}) {
    removeLoadingState();
    stopSpeech();
    
    const body = popupEl.querySelector(".popup-body");
    const subheader = popupEl.querySelector(".popup-subheader");
    const speakBtn = popupEl.querySelector(".footer-btn:nth-child(2)");

    body.innerHTML = `<div class="popup-loading-dots"><span></span><span></span><span></span></div>`;
    subheader.style.display = "none";
    speakBtn.style.display = "none";

    let promptText = "";
    let systemPrompt = "You are a precise writing assistant assisting in explaining, translating, and summarizing selected text.";

    if (actionId === "explain") {
      const mode = extraOptions.mode || "simple";
      subheader.style.display = "flex";
      subheader.innerHTML = `
        <span class="popup-label">Mode:</span>
        <select class="popup-select" id="explain-mode-select">
          <option value="simple" ${mode === "simple" ? "selected" : ""}>Simple Explanation</option>
          <option value="technical" ${mode === "technical" ? "selected" : ""}>Technical Details</option>
          <option value="eli5" ${mode === "eli5" ? "selected" : ""}>ELI5 (Like I'm 5)</option>
          <option value="examples" ${mode === "examples" ? "selected" : ""}>With Examples</option>
        </select>
      `;
      subheader.querySelector("#explain-mode-select").addEventListener("change", (e) => {
        runAction("explain", { mode: e.target.value });
      });

      const modePrompts = {
        simple: "Explain this selection in plain, simple language.",
        technical: "Explain this selection in detail with technical analysis and depth.",
        eli5: "Explain this selection like I am a 5-year-old child using simple analogies.",
        examples: "Explain this selection clearly and write practical examples showing how it applies."
      };

      systemPrompt = "You are an expert tutor. Explain the text selection using the requested mode and the surrounding context.";
      promptText = `${modePrompts[mode]}\n\nText selection:\n"${activeSelectionText}"\n\nSurrounding context:\n"${activeSelectionContext}"`;
      
      speakBtn.style.display = "inline-flex";
      speakBtn.dataset.lang = "en";
      
    } else if (actionId === "translate") {
      const targetLang = extraOptions.targetLang || "es";
      subheader.style.display = "flex";
      subheader.innerHTML = `
        <span class="popup-label">Translate to:</span>
        <select class="popup-select" id="translate-lang-select">
          <option value="en" ${targetLang === "en" ? "selected" : ""}>English</option>
          <option value="es" ${targetLang === "es" ? "selected" : ""}>Spanish</option>
          <option value="bn" ${targetLang === "bn" ? "selected" : ""}>Bangla</option>
          <option value="fr" ${targetLang === "fr" ? "selected" : ""}>French</option>
          <option value="de" ${targetLang === "de" ? "selected" : ""}>German</option>
          <option value="zh" ${targetLang === "zh" ? "selected" : ""}>Chinese</option>
          <option value="ar" ${targetLang === "ar" ? "selected" : ""}>Arabic</option>
          <option value="hi" ${targetLang === "hi" ? "selected" : ""}>Hindi</option>
          <option value="ja" ${targetLang === "ja" ? "selected" : ""}>Japanese</option>
          <option value="ko" ${targetLang === "ko" ? "selected" : ""}>Korean</option>
          <option value="ru" ${targetLang === "ru" ? "selected" : ""}>Russian</option>
          <option value="pt" ${targetLang === "pt" ? "selected" : ""}>Portuguese</option>
        </select>
      `;
      subheader.querySelector("#translate-lang-select").addEventListener("change", (e) => {
        runAction("translate", { targetLang: e.target.value });
      });

      const langNames = {
        en: "English", es: "Spanish", bn: "Bangla (Bengali)", fr: "French",
        de: "German", zh: "Chinese (Simplified)", ar: "Arabic", hi: "Hindi",
        ja: "Japanese", ko: "Korean", ru: "Russian", pt: "Portuguese"
      };

      systemPrompt = "You are a professional translator. Automatically detect the language of the selection and translate it into the requested target language. Respond ONLY with the translation — preserve structure and do not include annotations.";
      promptText = `Translate the following text to ${langNames[targetLang]}. Keep paragraphs intact:\n\n"${activeSelectionText}"`;
      
      speakBtn.style.display = "inline-flex";
      speakBtn.dataset.lang = targetLang;

    } else if (actionId === "summarize") {
      systemPrompt = "You are a summarizing assistant. Write a brief, concise summary of the selection.";
      promptText = `Summarize the following text selection. Use bullet points if it is long:\n\n"${activeSelectionText}"`;
      
      speakBtn.style.display = "inline-flex";
      speakBtn.dataset.lang = "en";
      
    } else if (actionId === "ask") {
      body.innerHTML = `Enter your question below to query the selected text.`;
      return;
    }

    streamFromLLM(systemPrompt, promptText);
  }

  // Trigger Custom Ask AI prompt
  function triggerAskAI(customQuery) {
    const body = popupEl.querySelector(".popup-body");
    const speakBtn = popupEl.querySelector(".footer-btn:nth-child(2)");
    const askInput = popupEl.querySelector(".popup-ask-input");

    body.innerHTML = `<div class="popup-loading-dots"><span></span><span></span><span></span></div>`;
    speakBtn.style.display = "none";
    askInput.value = "";

    const systemPrompt = "You are an AI assistant helping a user analyze a text selection from a webpage.";
    const promptText = `User question: ${customQuery}\n\nSelected text:\n"${activeSelectionText}"\n\nSurrounding context:\n"${activeSelectionContext}"`;
    
    streamFromLLM(systemPrompt, promptText);
  }

  // ---------- SSE Stream Connector ----------

  function streamFromLLM(systemPrompt, promptText) {
    const body = popupEl.querySelector(".popup-body");
    let accumulatedText = "";

    if (activePort) {
      activePort.disconnect();
    }

    activePort = chrome.runtime.connect({ name: "assistant" });
    activePort.postMessage({
      type: "ASK_ASSISTANT",
      systemPrompt,
      promptText
    });

    activePort.onMessage.addListener((msg) => {
      if (msg.type === "CHUNK") {
        removeLoadingState();
        accumulatedText += msg.delta;
        body.innerHTML = formatMarkdown(accumulatedText);
        body.scrollTop = body.scrollHeight; // scroll with stream
      } else if (msg.type === "DONE") {
        removeLoadingState();
        activePort.disconnect();
        activePort = null;
      } else if (msg.type === "ERROR") {
        removeLoadingState();
        body.innerHTML = `<div class="popup-error">Error: ${msg.message}</div>`;
        activePort.disconnect();
        activePort = null;
      }
    });

    activePort.onDisconnect.addListener(() => {
      activePort = null;
    });
  }

  function removeLoadingState() {
    const body = popupEl.querySelector(".popup-body");
    const dots = body.querySelector(".popup-loading-dots");
    if (dots) dots.remove();
  }

  // ---------- Web Speech Synthesis (TTS) ----------

  function startSpeech(text, langCode) {
    stopSpeech();

    if (!text) return;

    // Resolve voice language tag
    const langTag = LANGUAGE_VOICES[langCode] || "en-US";
    currentSpeechUtterance = new SpeechSynthesisUtterance(text);
    currentSpeechUtterance.lang = langTag;

    // Find custom voices for the language if possible
    const voices = window.speechSynthesis.getVoices();
    const matchingVoice = voices.find(v => v.lang.startsWith(langCode));
    if (matchingVoice) {
      currentSpeechUtterance.voice = matchingVoice;
    }

    currentSpeechUtterance.onend = () => {
      handleSpeechEnd();
    };

    currentSpeechUtterance.onerror = () => {
      handleSpeechEnd();
    };

    isSpeaking = true;
    updateSpeakButton(true);
    window.speechSynthesis.speak(currentSpeechUtterance);
  }

  function stopSpeech() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    handleSpeechEnd();
  }

  function handleSpeechEnd() {
    isSpeaking = false;
    currentSpeechUtterance = null;
    updateSpeakButton(false);
  }

  function updateSpeakButton(speaking) {
    if (!popupEl) return;
    const speakBtn = popupEl.querySelector(".footer-btn:nth-child(2)");
    if (!speakBtn) return;

    if (speaking) {
      speakBtn.classList.add("active");
      speakBtn.querySelector("span").textContent = "Stop";
    } else {
      speakBtn.classList.remove("active");
      speakBtn.querySelector("span").textContent = "Speak";
    }
  }

  // ---------- Context Menu Handler ----------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "CONTEXT_MENU_ACTION") {
      const action = message.action; // "explain" | "translate"
      const sel = window.getSelection();
      const text = sel.toString().trim();

      if (text) {
        activeSelectionText = text;
        if (sel.rangeCount === 0) {
          sendResponse({ ok: false, error: "No text selection range found." });
          return;
        }
        const range = sel.getRangeAt(0);
        activeSelectionContext = getSurroundingContext(range);
        
        const rect = range.getBoundingClientRect();
        selectionCoords = {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
          width: rect.width,
          height: rect.height
        };

        removeToolbar();
        showPopup(action);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "No text selected on page." });
      }
    }
    return true;
  });

})();
