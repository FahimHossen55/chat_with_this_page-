# 🤖 Chat With This Page

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/LLM_Provider-Groq-orange?style=for-the-badge&logo=groq&logoColor=white" alt="Groq" />
  <img src="https://img.shields.io/badge/License-MIT-brightgreen?style=for-the-badge" alt="MIT License" />
</p>

A state-of-the-art Chrome extension (Manifest V3) that lets you interact with, search, and analyze any webpage or PDF document using an LLM. It is backed by a lightweight FastAPI proxy that forwards requests to Groq's OpenAI-compatible completions API, keeping API keys secure on the backend.

---

## 🗺️ Contents

- [🚀 Core Features](#-core-features)
- [🏗️ Architecture & Data Flow](#️-architecture--data-flow)
- [📁 Repository Layout](#-repository-layout)
- [Prerequisites](#prerequisites)
- [🛠️ Local Development](#️-local-development)
  - [Backend Server](#backend-server)
  - [Chrome Extension](#chrome-extension)
- [⚙️ Configuration](#️-configuration)
- [📝 Using the Extension](#-using-the-extension)
- [🧪 Testing](#-testing)
- [🚢 Deployment](#-deployment)
- [⚠️ Limitations & Roadmap](#️-limitations--roadmap)

---

## 🚀 Core Features

### 💬 Chat with the Active Tab
* **In-Context Chatting**: Automatically extracts text from your active webpage or PDF document, giving the LLM accurate context.
* **Streamed Responses**: Real-time token-by-token streaming response delivery.
* **Per-Page History**: Tab conversations are saved per URL in local extension storage. Switching tabs or reopening pages automatically resumes your previous chat history.

### 🔎 Smart Search & Visual Jumping
* **AI-Powered Locating**: Ask a question to find specific clauses or points of interest on the current page.
* **Multi-Tiered Matcher**: Falls back gracefully across exact matches, sentence clauses, sliding word windows, and single text nodes to navigate layout boundaries (e.g. bolded words or list items).
* **Interactive UI Card**: Displays matches inside a premium yellow-bordered snippet card. Features a `📍 Jump to section` button to scroll and flash-highlight the match in the DOM.

### 📚 Smart PDF Reader (CORS-Bypassed)
* **CORS Workaround**: Routes cross-origin web PDF requests through the background service worker's declared permissions, avoiding browser CORS blocks.
* **Context Capping**: Caps extracted PDF context text at 15,000 characters to prevent Groq rate limits.
* **Local PDF Access**: Allows reading local `file://` PDF directories once the user grants file access permissions in Chrome settings.

### ✨ Selected Text Assistant (Shadow DOM Injected)
* **Floating Context Toolbar**: Appears dynamically when highlighting text on any webpage.
* **Encapsulated Shadow DOM UI**: Renders toolbars and popups inside a Shadow DOM container, guaranteeing host page styles never conflict with or break the assistant.
* **Assistant Modes**:
  * **Explain**: Offers *Simple*, *Technical*, *ELI5 (Explain Like I'm 5)*, and *With Examples* modes.
  * **Translate**: Auto-detects languages and translates into English, Spanish, Bangla, French, German, and 7 other languages. Includes native **Text-to-Speech (Read Aloud)** via the browser's `SpeechSynthesis` API.
  * **Summarize**: Condenses highlights into bullet points.
  * **Ask AI**: Custom question input box to chat directly about your selection.

---

## 🏗️ Architecture & Data Flow

```
┌───────────────────────────────┐          HTTP/SSE           ┌───────────────────────┐          HTTP/SSE         ┌─────────────┐
│       Chrome Extension        │ ──────────────────────────► │     FastAPI Proxy     │ ───────────────────────► │  Groq API   │
│ (Shadow DOM Popup / Side panel│ ◄────────────────────────── │ (backend/app/main.py) │ ◄────────────────────── │ (LLM Host)  │
│  + Background Service Worker) │      Streamed Tokens        │    /chat, /health     │     Streamed Tokens     │             │
└───────────────────────────────┘                             └───────────────────────┘                         └─────────────┘
```

The extension never exposes your `GROQ_API_KEY` to client-side pages. Instead:
1. The extension extracts webpage/PDF content.
2. It aggregates conversation history and the user prompt, sending it to the backend's `/chat` endpoint.
3. The FastAPI proxy forwards requests to Groq and streams response tokens back via Server-Sent Events (SSE).

---

## 📁 Repository Layout

```
extension/            Chrome extension (Manifest V3)
  manifest.json        Permissions, background scripts, content scripts, and assets
  assistant.js         Injected content script for Selected Text Assistant & Shadow DOM
  assistant.css        Shadow DOM encapsulated UI styling (light/dark themes)
  popup.html/js/css     Main Chat interface (shared by browser popup & side panel)
  sidepanel.html/css    Side-panel container that includes popup.js logic
  options.html/js/css   Settings page (configure backend URL and model)
  background.js         Service worker: manages CORS fetching, streaming, and context menus
  content.js            On-demand script injected to extract raw page text
  markdown.js           Safe markdown-to-HTML parser for rendering replies
  icons/                Extension logo assets (16x16, 48x48, 128x128)

backend/              FastAPI Proxy Server
  app/main.py           CORS setup, /chat SSE streaming, and /health checkers
  app/providers.py      Provider routing registry
  tests/                FastAPI endpoint and client integration tests
  Dockerfile            Container build configurations
  requirements.txt      Server dependencies
  requirements-dev.txt  Development and testing dependencies

docker-compose.yml    Hosts the FastAPI container + Uptime Kuma monitoring service
deploy/ec2-setup.sh   Bootstrap script for automated EC2 host provisioning
.github/workflows/    CI build/push action triggering on pushes to main
```

---

## Prerequisites

* **Google Chrome** (or a Chromium browser supporting Manifest V3)
* **Python 3.11+**
* A **[Groq API Key](https://console.groq.com/)**
* **Docker** (optional, for containerized deployments)

---

## 🛠️ Local Development

### Backend Server

Using `uv` (recommended):
```bash
cd backend
cp .env.example .env     # Add your GROQ_API_KEY
uv venv                  # Creates virtualenv
source .venv/bin/activate
uv pip install -r requirements.txt
uvicorn app.main:app --reload
```

Or using Docker:
```bash
cd backend
docker build -t chatwithpage-backend .
docker run --env-file .env -p 8000:8000 chatwithpage-backend
```

The API starts on `http://localhost:8000`. You can confirm it works by checking `GET http://localhost:8000/health`.

### Chrome Extension

1. Navigate to `chrome://extensions` in Chrome.
2. Toggle **Developer mode** on (top-right corner).
3. Click **Load unpacked** (top-left) and select the `extension/` directory.
4. Right-click the extension icon in your toolbar, select **Options** (or click the gear icon inside the popup), and configure your **Backend URL** (default is `http://localhost:8000`). Click **Test** to confirm connectivity.

---

## ⚙️ Configuration

### Extension Settings
Saved in `chrome.storage.sync` via the Options panel:
* **Backend URL**: Points to your proxy server (`http://localhost:8000`).
* **Provider**: Set to `groq`.
* **Model**: Choose from default models, e.g. `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `qwen/qwen3-32b`, etc.

### Backend Environment Settings
Configured in `backend/.env`:
* `GROQ_API_KEY`: Groq API authorization token.

---

## 📝 Using the Extension

* **Chat Panel**: Open the popup, or click the side-panel button in the header. Conversations persist by URL.
* **Interactive Smart Search**: Type queries in the Smart Search field. Click `📍 Jump to section` to immediately scroll to matched highlights.
* **Inline Selection Assistant**: Highlight any paragraph. Click `✨ Explain` (ELI5, Technical, etc.) or `🌐 Translate` (with text-to-speech) directly on the page.
* **Right-Click Context Menu**: Right-click highlighted selections to trigger explanations or translations in the page assistant, or open prefilled queries inside the sidepanel.

---

## 🧪 Testing

The backend test suite verifies endpoint responses, SSE stream formats, CORS setups, and error mapping.

Using the virtual environment's pytest tool:
```bash
cd backend
.venv/bin/pytest
```

---

## 🚢 Deployment

* **CI Pipeline**: `.github/workflows/deploy.yml` builds and pushes the proxy Docker image to Docker Hub on merges to `main`.
* **Host Setup**: `deploy/ec2-setup.sh` acts as a deployment script for AWS EC2 instances, setting up Docker Compose and environment templates.
* **Compose Orchestration**: `docker-compose.yml` mounts the FastAPI backend on port `8000` alongside an **Uptime Kuma** monitoring panel on port `3001`.

---

## ⚠️ Limitations & Roadmap

* **Text Capping**: Web page text is capped at 12,000 characters, and PDFs are capped at 15,000 characters to comply with Groq free-tier rate limits.
* **Scanned PDFs**: The extension reads selectable text. Image-only/scanned PDFs require host-side OCR conversion to parse.
* **Security**: The backend proxy has no authentication layer. Secure it using an API gateway or firewall before exposing it publicly.

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) (if added) for details.
