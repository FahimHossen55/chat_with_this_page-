# Chat With This Page

A Chrome extension (Manifest V3) that lets you chat with the content of whatever page
you're currently viewing, backed by a small FastAPI proxy that forwards requests to Groq's
OpenAI-compatible chat completions API. The backend is containerized with Docker and built
via GitHub Actions on every push to `main`.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Local development](#local-development)
  - [Backend](#backend)
  - [Extension](#extension)
- [Configuration](#configuration)
- [Using the extension](#using-the-extension)
- [Backend API](#backend-api)
- [Testing](#testing)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)
- [License](#license)

## Features

- **Chat with the active tab** — extracts the visible text of the current page and answers
  questions about it, with responses streamed token-by-token.
- **Popup or side panel** — use the compact popup, or pop the same conversation out into
  Chrome's side panel so it survives while you scroll or switch tabs.
- **Per-page conversation history** — history is kept per URL (in `chrome.storage.local`),
  so re-opening the same page resumes that page's conversation.
- **Right-click context menu** — select text on any page and either "Ask AI about" the
  selection or send it straight to the assistant as a translation prompt.
- **Configurable model/backend** — pick the Groq model and point the extension at any
  backend URL from the Options page.
- **Markdown rendering** — assistant replies are rendered through a small, sandboxed
  markdown-to-HTML renderer (safe against the LLM output being untrusted).

## Architecture

```
┌─────────────────────┐        HTTPS         ┌──────────────────────┐        HTTPS        ┌──────────┐
│ Chrome Extension     │ ───────────────────► │ FastAPI proxy         │ ──────────────────► │  Groq    │
│ (popup/side panel +  │ ◄─────────────────── │ (backend/app/main.py) │ ◄────────────────── │  API     │
│  background worker)  │   SSE token stream    │  /chat, /health       │   SSE token stream   │          │
└─────────────────────┘                       └──────────────────────┘                     └──────────┘
```

The extension never talks to Groq directly — the backend holds the `GROQ_API_KEY` and is
the only thing that needs it. The extension folds the extracted page text, conversation
history, and the user's question into a single OpenAI-style `messages` array and posts it
to the backend's `/chat` endpoint, which streams the response back as Server-Sent Events.

## Repository layout

```
extension/            Chrome extension (Manifest V3)
  manifest.json        Permissions, icons, popup/side-panel/options wiring
  popup.html/js/css     Chat UI (shared by the popup and the side panel)
  sidepanel.html/css    Side-panel-only shell around the same popup.js
  options.html/js/css   Settings page (backend URL, model)
  background.js         Service worker: streaming, storage, context menu
  content.js             Injected on demand to extract page text
  markdown.js            Sandboxed markdown → HTML renderer for replies
  icons/                 Toolbar/store icons

backend/              FastAPI proxy
  app/main.py           /chat (streaming) and /health routes, CORS
  app/providers.py       Provider registry (currently: Groq only)
  tests/                 pytest + respx tests for the API
  Dockerfile
  requirements.txt / requirements-dev.txt
  .env.example

docker-compose.yml    Runs the backend + Uptime Kuma on the host
deploy/ec2-setup.sh   One-time bootstrap script for a fresh EC2 instance
.github/workflows/    CI: build & push the backend image on push to main / version tags
```

## Prerequisites

- Google Chrome (or another Chromium-based browser with Manifest V3 + Side Panel support)
- Python 3.11 (see `.python-version`)
- A [Groq API key](https://console.groq.com/) for the backend
- Docker, if you want to run the backend containerized instead of via a venv

## Local development

### Backend

```bash
cd backend
cp .env.example .env         # fill in GROQ_API_KEY
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload
```

Or with Docker:

```bash
cd backend
docker build -t chatwithpage-backend .
docker run --env-file .env -p 8000:8000 chatwithpage-backend
```

The backend listens on `http://localhost:8000` by default; `GET /health` should return
`{"status": "ok"}` once it's up.

### Extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Open the extension's **Options** page (right-click its toolbar icon → Options, or the
   gear icon in the popup) and set **Backend URL** to `http://localhost:8000` (default) or
   your deployed backend address. Use the **Test** button to confirm connectivity.

There is no build step — the extension is loaded unpacked as plain HTML/CSS/JS, so edits to
`extension/` take effect after clicking the reload icon on `chrome://extensions`.

## Configuration

Settings are stored in `chrome.storage.sync` via the Options page:

| Setting       | Default                    | Notes                                              |
|---------------|-----------------------------|-----------------------------------------------------|
| Backend URL   | `http://localhost:8000`     | Where the extension sends `/chat` and `/health`.    |
| Provider      | `groq`                      | Only provider currently wired up on the backend.    |
| Model         | `llama-3.1-8b-instant`      | Also selectable: `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3-32b`. |

There is no API key field in the extension UI by design — API keys live only on the
backend server, configured via the environment variable below.

Backend environment variables (`backend/.env`, see `.env.example`):

| Variable        | Required | Purpose                                   |
|-----------------|----------|--------------------------------------------|
| `GROQ_API_KEY`  | Yes      | Used as the bearer token when calling Groq. |

## Using the extension

- **Ask a question** — open the popup (or side panel) on any page and type a question;
  the reply streams in as it's generated.
- **Open in side panel** — click the side-panel icon in the popup header to move the
  conversation into Chrome's side panel, which stays open across page scrolling.
- **Ask about a selection** — select text on a page, right-click, choose **"Ask AI about
  '...'"**; it opens the side panel (falling back to the popup) with your selection
  pre-filled as context for your next question.
- **Translate selection** — select text, right-click, choose **"Translate '...' to
  Bangla"** to get an instant translation.
- **Clear conversation** — the trash icon clears the stored history for the current page's
  URL only.

Conversation history is capped: the last 6 turns are sent as context per request, and only
the 50 most recently used page URLs are retained in storage (older ones are evicted).

## Backend API

### `GET /health`

Returns `{"status": "ok"}`. Used by the extension's "Test" button and by Docker's
`HEALTHCHECK`.

### `POST /chat`

Request body:

```json
{
  "provider": "groq",
  "model": "llama-3.1-8b-instant",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stream": true
}
```

- `provider` — must match a key in `backend/app/providers.py` (currently only `"groq"`);
  unknown providers return `400`.
- `model` — optional; falls back to the provider's default model if omitted.
- `messages` — OpenAI-style chat messages. The extension is responsible for folding the
  extracted page content and prior conversation turns into this array before calling the
  backend — the backend itself has no separate "page content" field.

Response: `text/event-stream` — the backend proxies Groq's SSE stream through unchanged.
Missing the provider's API key on the server returns `500`.

## Testing

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest
```

Tests use `respx` to mock the Groq endpoint and cover the health check, unknown-provider
handling, missing-API-key handling, and a streamed success case.

## Deployment

- **CI** (`.github/workflows/deploy.yml`) builds and pushes a Docker image to Docker Hub
  whenever `backend/**`, `docker-compose.yml`, or the workflow file change on `main`, or
  when a `v*.*.*` tag is pushed. Images are tagged with the short git SHA, `latest`, and
  (for tag pushes) the semver tag itself.
- **Host setup** (`deploy/ec2-setup.sh`) is a one-time, manually-run bootstrap script for a
  fresh EC2 instance: installs Docker + the Compose plugin, creates `/opt/chatwithpage`,
  and seeds a `.env` template.
- **Runtime** (`docker-compose.yml`) runs two services on the host: the backend
  (port `8000`) and [Uptime Kuma](https://github.com/louislam/uptime-kuma) (port `3001`)
  for monitoring.
- Required GitHub Actions secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`. The EC2-side
  secrets referenced by `ec2-setup.sh` (`EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`) are for a
  redeploy-to-EC2 step that is **not yet implemented** in the workflow — today, pushing to
  `main` builds and publishes the image but does not automatically redeploy it; redeploying
  on the EC2 host is currently a manual `docker compose pull && docker compose up -d`.

## Known limitations

- Only Groq is wired up as a provider today, though `providers.py` is structured so adding
  another is a new dict entry rather than a rewrite.
- No rate limiting or auth on the backend `/chat` endpoint — treat it as trusted-network
  or add a reverse proxy / API gateway in front of it before exposing it publicly.
- Page content extraction is a plain `innerText` grab (with boilerplate tags stripped), not
  a readability-style main-content extraction, and is hard-truncated at 12,000 characters.
- There is no automated EC2 redeploy step yet (see Deployment above).

## License

No license file is currently included in this repository.
