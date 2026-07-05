// Auto-injected on every github.com page (declared content_script — unlike
// content.js, which is only injected on demand). Detects repo pages and
// renders a "GitHub Mode" toggle button in the top-right corner; clicking it
// opens a dropdown of actions. Each action hands the click off to
// background.js (GITHUB_MODE_ACTION), which fetches the relevant GitHub API
// data, builds a question + context, and surfaces the extension's chat UI
// with it pre-filled — this script only ever deals with detection and
// rendering, never the GitHub API itself.

// Path segments that are GitHub's own top-level routes, not usernames/orgs —
// used to avoid mistaking e.g. github.com/settings/profile for a repo page.
const RESERVED_OWNERS = new Set([
  "marketplace", "notifications", "settings", "explore", "topics", "trending",
  "sponsors", "codespaces", "dashboard", "new", "orgs", "organizations",
  "about", "pricing", "features", "security", "resources", "customer-stories",
  "site", "apps", "collections", "events", "account", "login", "join",
  "logout", "search", "gist", "gists", "readme", "watching", "stars",
  "issues", "pulls", "notifications",
]);

const ACTIONS = [
  { id: "architecture", label: "Architecture", icon: "\u{1F3DB}️" },
  { id: "folder-structure", label: "Folder structure", icon: "\u{1F4C1}" },
  { id: "installation", label: "Installation", icon: "⚙️" },
  { id: "dependencies", label: "Dependencies", icon: "\u{1F4E6}" },
  { id: "explain-bug", label: "Explain bug", icon: "\u{1F41B}", requires: "issue" },
  { id: "generate-readme", label: "Generate README", icon: "\u{1F4DD}" },
  { id: "generate-docs", label: "Generate docs", icon: "\u{1F4C4}" },
  { id: "explain-function", label: "Explain function", icon: "\u{1F50E}", requires: "blob" },
];

let currentUrl = "";
let railEl = null;

function parseRepoContext() {
  const segments = location.pathname.split("/").filter(Boolean);
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
}

function buildRail() {
  const rail = document.createElement("div");
  rail.id = "cwtp-github-rail";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "cwtp-toggle-btn";
  toggle.title = "Toggle GitHub Mode";
  toggle.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cwtp-menu-svg" style="width: 18px; height: 18px; display: block;"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>';
  rail.appendChild(toggle);

  const dropdown = document.createElement("div");
  dropdown.className = "cwtp-dropdown";

  const heading = document.createElement("div");
  heading.className = "cwtp-rail-heading";
  heading.textContent = "This is GitHub Mode — pick an action";
  dropdown.appendChild(heading);

  ACTIONS.forEach((action) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cwtp-rail-btn";
    btn.dataset.action = action.id;
    btn.innerHTML =
      `<span class="cwtp-rail-icon">${action.icon}</span>` +
      `<span class="cwtp-rail-label">${action.label}</span>`;
    dropdown.appendChild(btn);
  });

  rail.appendChild(dropdown);

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    rail.classList.toggle("open");
  });

  dropdown.addEventListener("click", (e) => {
    const btn = e.target.closest(".cwtp-rail-btn");
    if (!btn || btn.disabled) return;
    handleActionClick(btn);
  });

  // Clicking anywhere outside the menu closes it, same as any other
  // top-of-page dropdown (e.g. GitHub's own profile/notifications menus).
  document.addEventListener("click", (e) => {
    if (!rail.contains(e.target)) rail.classList.remove("open");
  });

  return rail;
}

function updateRailAvailability(ctx) {
  if (!railEl) return;
  railEl.querySelectorAll(".cwtp-rail-btn").forEach((btn) => {
    const action = ACTIONS.find((a) => a.id === btn.dataset.action);
    const needsBlob = action.requires === "blob" && ctx.pageType !== "blob";
    const needsIssue = action.requires === "issue" && ctx.pageType !== "issue";
    const disabled = needsBlob || needsIssue;
    btn.disabled = disabled;
    btn.title = needsBlob
      ? "Open a file to use this"
      : needsIssue
        ? "Open an issue to use this"
        : "";
  });
}

async function handleActionClick(btn) {
  const ctx = parseRepoContext();
  if (!ctx) return;

  const originalHtml = btn.innerHTML;
  btn.classList.add("cwtp-loading");
  btn.disabled = true;

  const selection = window.getSelection()?.toString().trim() || null;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GITHUB_MODE_ACTION",
      action: btn.dataset.action,
      owner: ctx.owner,
      repo: ctx.repo,
      ref: ctx.ref,
      path: ctx.path,
      issueNumber: ctx.issueNumber,
      selection: btn.dataset.action === "explain-function" ? selection : null,
    });
    if (!response?.ok) {
      showToast(response?.error || "Something went wrong fetching GitHub data.");
    } else {
      railEl.classList.remove("open");
    }
  } catch (err) {
    showToast(err.message || "Couldn't reach the extension.");
  } finally {
    btn.classList.remove("cwtp-loading");
    btn.innerHTML = originalHtml;
    updateRailAvailability(ctx);
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "cwtp-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function render() {
  const ctx = parseRepoContext();
  if (!ctx) {
    railEl?.remove();
    railEl = null;
    return;
  }
  if (!railEl) {
    railEl = buildRail();
    document.body.appendChild(railEl);
  }
  updateRailAvailability(ctx);
}

// GitHub navigates via Turbo (no full page reloads on most link clicks), so
// a one-shot render on script load would go stale the moment the user clicks
// into a repo or from one repo to another. Polling location.href is the
// simplest reliable way to catch that without depending on Turbo's internal
// event names, which have changed across GitHub's history.
currentUrl = location.href;
render();
setInterval(() => {
  if (location.href === currentUrl) return;
  currentUrl = location.href;
  render();
}, 800);
