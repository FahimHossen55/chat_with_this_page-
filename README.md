# <p align="center"><img src="./high-resolution-logo-grayscale.png" alt="Research OS Logo" width="480"/></p>

<p align="center">
  <a href="https://developer.chrome.com/docs/extensions/mv3/intro/">
    <img src="https://img.shields.io/badge/Manifest-V3-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Manifest V3" />
  </a>
  <a href="https://fastapi.tiangolo.com/">
    <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  </a>
  <a href="https://postgresql.org/">
    <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  </a>
  <a href="https://www.docker.com/">
    <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
  </a>
  <a href="https://groq.com/">
    <img src="https://img.shields.io/badge/LLM-Groq-orange?style=for-the-badge&logo=groq&logoColor=white" alt="Groq" />
  </a>
</p>

---

**Research OS** (also known as *Chat With This Page*) is a state-of-the-art Chromium research workstation (Manifest V3) backed by an enterprise-grade FastAPI proxy and PostgreSQL database. Designed for researchers, software developers, and students, the platform allows you to interact with, search, and analyze any webpage, academic paper, PDF document, or GitHub repository in real time using high-performance Large Language Models (LLMs) via the Groq API.

The suite integrates advanced academic literature searches, database-backed user authentication via Google OAuth2, tab-isolated conversation histories, and specialized interactive toolbars that layer directly onto active windows without interfering with website layouts.

---

## 🗺️ Table of Contents

- [🚀 Key Features](#-key-features)
  - [💬 In-Context Chat Panel & Tab Isolation](#-in-context-chat-panel--tab-isolation)
  - [🔎 AI Smart Search & Highlight Jumping](#-ai-smart-search--highlight-jumping)
  - [📚 Integrated Academic Literature Hub](#-integrated-academic-literature-hub)
  - [📊 Integrated Dataset Finder & Metadata Classifier](#-integrated-dataset-finder--metadata-classifier)
  - [📄 CORS-Bypassed Smart PDF Analyzer](#-cors-bypassed-smart-pdf-analyzer)
  - [✨ Encapsulated Shadow-DOM Selection Assistant](#-encapsulated-shadow-dom-selection-assistant)
  - [💻 Intelligent GitHub Mode Overlay](#-intelligent-github-mode-overlay)
- [🏗️ System Architecture & Data Flow](#-system-architecture--data-flow)
- [📁 Repository Directory Structure](#-repository-directory-structure)
- [📋 Prerequisites](#-prerequisites)
- [🛠️ Local Development Setup](#-local-development-setup)
  - [1. Database Configuration](#1-database-configuration)
  - [2. Google OAuth2 Client Configuration](#2-google-oauth2-client-configuration)
  - [3. Backend Proxy Setup](#3-backend-proxy-setup)
  - [4. Chrome Extension Installation](#4-chrome-extension-installation)
- [⚙️ Configuration & Environment Reference](#-configuration--environment-reference)
- [💡 Usage Guide](#-usage-guide)
- [🧪 Testing Suite](#-testing-suite)
- [🚢 Production Deployment](#-production-deployment)
- [⚠️ Limitations & Security Guidelines](#-limitations--security-guidelines)
- [📄 License](#-license)

---

## 🚀 Key Features

### 💬 In-Context Chat Panel & Tab Isolation
* **Smart Page Extraction**: Automatically reads the main text content of your active tab, cleans scripts and styles, and feeds it as system context directly to the LLM.
* **Server-Sent Events (SSE)**: Streams answers token-by-token for responsive, real-time feedback with zero network buffering.
* **Tab-Isolated Chat Persistence**: Conversation records are saved to the PostgreSQL server and mapped to specific page URLs. Switching tabs or closing and reopening pages seamlessly restores the exact dialogue history corresponding to that domain.

### 🔎 AI Smart Search & Highlight Jumping
* **Verbatim Location Matching**: Ask questions about details on the page (e.g. *"Where is the license key explained?"*), and the AI resolves the exact section of text.
* **Fallback Matcher Pipeline**: Leverages exact string matches, semantic clauses, sliding word windows, and single text nodes to resolve layout gaps (like bolded words, anchors, or list bullets).
* **Interactive Match Cards**: Highlights search results in a premium, yellow-bordered card. Clicking the **📍 Jump to section** button scrolls the window directly to the section and flashes it to draw your eyes immediately.

### 📚 Integrated Academic Literature Hub
Directly search and extract scholarly articles from six major publishers from inside your extension panel:
* **Engines Queried**: arXiv (XML parser), Semantic Scholar, OpenAlex, IEEE Xplore, Google Scholar (via Serp API), and Nature Scientific Data.
* **Rich Filtering**: Filter search queries by Open Access status, publication year ranges, sorting algorithms (Relevance, Newest, Citations), and author profile lookups.
* **Similar Paper Discovery**: Find and pull related papers to expand your reading list using Semantic Scholar reference maps.

### 📊 Integrated Dataset Finder & Metadata Classifier
Find empirical datasets directly from Hugging Face, OpenML, Zenodo, Papers with Code, Kaggle (simulated), UCI ML repository (simulated), and IEEE DataPort (simulated):
* **Metadata Classifier Heuristic**: Automatically parses names and description content to infer the dataset's **Modality** (Tabular, Image, Text, Audio, Video, EEG, ECG, Sensor, Graph), **Domain** (Healthcare, Computer Vision, NLP, Robotics, Finance, Cybersecurity, Remote Sensing, Education), and **Task** (Classification, Regression, Time Series, Object Detection, etc.).
* **Advanced Filters**: Filter queries by size (Small, Medium, Large), dataset file formats (CSV, Parquet, JSON, ZIP), and license types (MIT, CC, Apache).

### 📄 CORS-Bypassed Smart PDF Analyzer
* **CORS Block Bypass**: Fetches cross-origin PDF buffers via the background service worker, bypassing browser security blocks.
* **Local Files Integration**: Fully parses local `file:///` PDFs once the user enables "Allow access to file URLs" in extension settings.
* **Token Guardrails**: Limits extracted text context to a smart cap of 15,000 characters to protect against context overflow and model rate limits.
* **Automated PDF Workflows**:
  * **Summarize**: Get a comprehensive summary of main topics, findings, and conclusions.
  * **Search Concepts**: Extract key terminology, definitions, and topics with page references.
  * **Explain Equations**: Identifies and interprets mathematical equations and technical notations in plain English.
  * **Study Flashcards**: Generates a set of 8 study flashcards (Q&A format) based on the document.
  * **Extract Tables**: Formats structured tables and figures into markdown grids.
  * **Generate Citation**: Generates proper citations in APA, MLA, and BibTeX formats.

### ✨ Encapsulated Shadow-DOM Selection Assistant
* **Host Style Isolation**: The floating toolbar and AI response cards are wrapped inside a Shadow DOM. This ensures that host website styles never bleed into, distort, or break the extension interface.
* **Quick Actions**:
  * **Explain**: Breakdown code or text tailored to your preference (*Simple*, *Technical*, *ELI5*, or *With Examples*).
  * **Translate**: Auto-detects the source language and translates to 12 languages.
  * **Read Aloud**: Synthesizes translation text into speech using the native Web Speech API.
  * **Summarize**: Condenses selected paragraphs into concise bullet points.
  * **Ask AI**: Input queries directly about your highlighted section.

### 💻 Intelligent GitHub Mode Overlay
Detects if you are viewing a `github.com` directory, file, or issue, and overlays a premium floating vertical action rail with automated operations:
* 🏛️ **Architecture**: Analyzes directory trees, code manifests, and README files to outline the overall architecture.
* 📁 **Folder Structure**: Maps the functional role of each folder.
* ⚙️ **Installation**: Parses documentation to write setup scripts.
* 📦 **Dependencies**: Reads package manifests (`package.json`, `requirements.txt`, `pyproject.toml`, etc.) and outlines key dependencies.
* 🐛 **Explain Bug**: Summarizes issue descriptions and comment discussions to recommend fixes.
* 🔎 **Explain Function**: Interprets selected code blobs or methods.

---

## 🏗️ System Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Client [Chrome Extension - Research OS]
        ActiveTab[Active Page / PDF / GitHub]
        
        subgraph Scripts [Injected Scripts]
            ContentScript[content.js <br/> Scrapes Page Text]
            AssistantScript[assistant.js <br/> Shadow DOM Assistant]
            GithubScript[github.js <br/> Git Action Rail]
        end
        
        subgraph UI [Extension UI Pages]
            Popup[popup.html / js <br/> Popup View]
            SidePanel[sidepanel.html / js <br/> Side Panel View]
            Options[options.html / js <br/> Settings Page]
        end
        
        BackgroundWorker[background.js <br/> Service Worker]
        Storage[(chrome.storage.sync / session)]
    end

    subgraph Backend [FastAPI Proxy Server]
        FastAPIMain[app/main.py <br/> FastAPI Router]
        Auth[app/auth.py <br/> JWT & State Token Validation]
        Literature[app/literature.py <br/> Academic API Aggregator]
        Datasets[app/datasets.py <br/> Dataset Parser]
        DB_Model[(PostgreSQL Database)]
    end

    subgraph External [External APIs]
        Groq[Groq API <br/> LLM Completions]
        GoogleOAuth[Google Accounts <br/> OAuth2 Sign-In]
        AcadAPIs[Academic Services <br/> arXiv / SemScholar / OpenAlex / IEEE / Google Scholar]
        DataAPIs[Data Hubs <br/> Hugging Face / OpenML / Zenodo / PapersWithCode]
    end

    %% Client Inner Flows
    ActiveTab -.->|User Selection / URL Trigger| Scripts
    Scripts -->|Message Passing| BackgroundWorker
    UI <-->|Pending Payloads / Config| Storage
    BackgroundWorker <-->|Read / Write Settings| Storage
    UI <-->|Initialize SSE Connection| BackgroundWorker

    %% Network Flow
    BackgroundWorker <-->|Streaming HTTP POST / GET| FastAPIMain
    FastAPIMain <-->|Forwarded Stream SSE| Groq
    FastAPIMain <-->|Google Login / Callback Redirects| GoogleOAuth
    FastAPIMain <-->|Perform SQL Queries| DB_Model
    FastAPIMain <-->|Aggregated Academic Search| AcadAPIs
    FastAPIMain <-->|Metadata & Download Search| DataAPIs

    %% Styles
    classDef clientStyle fill:#f4f5f7,stroke:#334155,stroke-width:2px;
    classDef backendStyle fill:#ecfdf5,stroke:#059669,stroke-width:2px;
    classDef externalStyle fill:#fffbeb,stroke:#d97706,stroke-width:2px;
    class Client clientStyle;
    class Backend backendStyle;
    class External externalStyle;
```

### Protocol Operations Flow
1. **Authentication (OAuth2)**: The extension initiates sign-in by hitting `/auth/login` on the backend, which redirects the tab to the Google Accounts page. On success, Google redirects back to the backend `/auth/callback` endpoint where the user is upserted into PostgreSQL, a JWT is signed, and the browser is redirected back to the Chrome extension's internal listener with credentials.
2. **Context Aggregation**: The injected context script extracts active page content, enforces truncation guards (12k characters for web, 15k characters for PDF), and posts the payload to the background script.
3. **Streaming Responses**: The background service worker sends the context-primed request carrying the bearer JWT to the FastAPI `/chat` endpoint. FastAPI proxies the requests to Groq and streams responses back to the extension UI using SSE.

---

## 📁 Repository Directory Structure

```
├── backend/                    # FastAPI Proxy Server
│   ├── app/
│   │   ├── main.py             # Server routes, Google OAuth handlers, search wrappers, history SQL endpoints
│   │   ├── auth.py             # JWT generation, token verification, state nonce checking
│   │   ├── database.py         # SQLAlchemy Base models (User, ChatHistory) and postgres pool setup
│   │   ├── datasets.py         # Hugging Face, Zenodo, OpenML, PapersWithCode search logic
│   │   ├── literature.py       # arXiv XML parse, Semantic Scholar, OpenAlex search integration
│   │   └── providers.py        # LLM Provider mapping configurations
│   ├── tests/                  # Pytest unit and integration tests
│   ├── Dockerfile              # Docker container builder for FastAPI service
│   ├── requirements.txt        # Production python packages
│   └── requirements-dev.txt    # Formatting and testing dependencies
├── extension/                  # Chrome Extension Client (Manifest V3)
│   ├── manifest.json           # Extension descriptor, permissions, content-scripts declaration
│   ├── assistant.js            # Hover menu / Selection tool injector inside shadow DOM
│   ├── assistant.css           # Styling sheet for shadow DOM elements
│   ├── github.js               # GitHub Action Rail overlay scripts
│   ├── github.css              # Action Rail CSS rules
│   ├── background.js           # PDF downloader proxy, context-menu handlers, message broker
│   ├── content.js              # Visible page text extractor script
│   ├── markdown.js             # Basic parser for LLM response rendering
│   ├── options.html/js/css     # Backend connection and preferences portal
│   ├── popup.html/js/css       # Standalone floating popup chat view
│   ├── sidepanel.html/css      # Sidebar persistent context chat view
│   └── icons/                  # Visual graphics assets
├── deploy/
│   └── ec2-setup.sh            # One-click Ubuntu server deployment script
├── docker-compose.yml          # Compose stack (FastAPI Backend + Postgres + Uptime Kuma)
└── high-resolution-logo-grayscale.png # Grayscale branding asset
```

---

## 📋 Prerequisites

To run this platform locally, make sure you have the following installed:
* **Google Chrome** (or other Chromium browser such as Edge, Brave, Vivaldi, Opera)
* **Python 3.11+** and **`uv`** (fast Python packager)
* **PostgreSQL 15+** database
* A **[Groq API Key](https://console.groq.com/)**
* **Docker & Docker Compose** (optional, for complete container setup)

---

## 🛠️ Local Development Setup

### 1. Database Configuration
Ensure a PostgreSQL database named `chatwithpage` is running locally or in Docker. Create the database:
```sql
CREATE DATABASE chatwithpage;
```
For default setups, the backend searches for `postgresql://postgres:changeme@localhost:5432/chatwithpage`.

---

### 2. Google OAuth2 Client Configuration
1. Go to the [Google Cloud Console Credentials Page](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth client ID** credential with application type **Web application**.
3. Set the **Authorized redirect URIs** to:
   ```
   http://localhost:8000/auth/callback
   ```
4. Save the Client ID and Client Secret values for your backend env configuration.

---

### 3. Backend Proxy Setup

#### Option A: Native installation using `uv` (Recommended)
`uv` is an ultra-fast Python package installer and resolver.
```bash
# Navigate to backend directory
cd backend

# Create your local environment configuration file
cp .env.example .env

# Edit .env and enter your key credentials (database, Groq, Google OAuth)
# GROQ_API_KEY=gsk_your_key_here
# DATABASE_URL=postgresql://postgres:changeme@localhost:5432/chatwithpage
# GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
# GOOGLE_CLIENT_SECRET=your_client_secret

# Initialize virtual environment and install dependencies
uv venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
uv pip install -r requirements.txt

# Start the uvicorn development server
uvicorn app.main:app --reload
```

#### Option B: Docker Containers (Backend + DB + Uptime Kuma)
If you prefer running a containerized stack, Docker Compose will build the backend, launch PostgreSQL, and configure volumes automatically:
```bash
# Ensure .env values are filled in the root/backend folder
docker compose up --build -d
```
The server will run on `http://localhost:8000` and Uptime Kuma status panel will run on `http://localhost:3001`.
Verify the backend status by navigating to `http://localhost:8000/health` (returns `{"status":"ok"}`).

---

### 4. Chrome Extension Installation

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Turn on **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the `extension/` folder in your cloned repository directory.
5. Grant URL permissions (to allow PDF reading of local files):
   * Inside `chrome://extensions/`, click **Details** under the Research OS extension card.
   * Enable the toggle **Allow access to file URLs**.
6. Set up your connection:
   * Right-click the extension icon in your Chrome toolbar and select **Options**.
   * Enter your backend proxy URL (default is `http://localhost:8000`).
   * Click **Test Connection** to verify API handshakes, then click **Save**.

---

## ⚙️ Configuration & Environment Reference

### Extension Storage Variables
Configurations are saved securely inside `chrome.storage.sync` and customized via the options page:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| **Backend URL** | `http://localhost:8000` | Address pointing to your running FastAPI server. |
| **Provider** | `groq` | Registered proxy service provider. |
| **Model** | `llama-3.1-8b-instant` | The model used for streaming responses. |

### Backend Env Variables (`backend/.env`)

| Env Variable | Required | Description |
| :--- | :--- | :--- |
| `GROQ_API_KEY` | **Yes** | Your API token from Groq Console. |
| `DATABASE_URL` | **Yes** | PostgreSQL connection URL string. |
| `GOOGLE_CLIENT_ID` | **Yes** | Client ID from Google Credentials Console. |
| `GOOGLE_CLIENT_SECRET` | **Yes** | Client Secret from Google Credentials Console. |
| `JWT_SECRET` | No | Secret key for signing session tokens (fallback exists). |
| `JWT_ALGORITHM` | No | Algorithm used to sign tokens (default: `HS256`). |

> [!NOTE]
> For testing and sandbox setups, setting `GOOGLE_CLIENT_ID` to `dummy_client_id.apps.googleusercontent.com` enables an automated bypass mode. This redirects authentication requests directly to a simulated mock user account (`test.user@example.com`), allowing developer testing without requiring active Google API credentials.

---

## 💡 Usage Guide

> [!TIP]
> Pin the extension to your Chrome toolbar for fast, one-click access.

* **OAuth Sign-In**: Before querying pages, open the chat panel, click the User Profile button in the top-right, and click **Log In with Google**. This authenticates your browser session.
* **Domain Chat History**: Open the popup or sidepanel via the extension toolbar, input queries, and chat with the page text. When switching tabs, the dialog resets to fit the current page. Switching back to the first tab restores the exact previous conversation history.
* **Inline Selection Assistant**: Highlight text or paragraphs on any page. Hover over the floating ✨ icon, and click quick actions like **Explain**, **Summarize**, **Translate**, or input a custom prompt via **Ask**.
* **Deploy GitHub Rails**: Load a public repository (e.g. `https://github.com/fastapi/fastapi`). A vertical action rail with a GitHub icon appears on the right edge of the window. Expand it to trigger structured analysis cards.
* **Dataset & Literature Searches**: Click the top dropdown options button in the sidepanel. Select **Literature Search** or **Dataset Search** to expand filter accordions, input keywords, and view detailed cards. Click on results to open PDF documents, retrieve citation metadata, or download dataset repositories.

---

## 🧪 Testing Suite

Automated pytest configurations cover database models, authentication bypass states, endpoint routing, and streaming mock completions.
```bash
# Navigate to the backend directory
cd backend

# Activate virtual environment
source .venv/bin/activate

# Run full tests with verbose output
pytest -v
```

---

## 🚢 Production Deployment

The project includes custom configurations to host the backend server on cloud platforms like AWS, GCP, Azure, or DigitalOcean:

### Cloud Infrastructure Setup Script
The script `deploy/ec2-setup.sh` automates VM orchestration:
* Updates repositories and core dependencies.
* Installs **Docker** and **Docker Compose**.
* Clones this codebase repository, maps directories, creates default environment variables, and enables UFW firewall rule security guidelines.

To run the VM setup script:
```bash
chmod +x deploy/ec2-setup.sh
sudo ./deploy/ec2-setup.sh
```

---

## ⚠️ Limitations & Security Guidelines

> [!WARNING]
> **Token Constraints**: The extension truncates extracted page contents (12,000 chars for webpages, 15,000 chars for PDFs) to fit within free-tier API rate limits. If a page or file is excessively long, only the upper sections are read.

> [!IMPORTANT]
> **Scanned Document Support**: PDF text parsing extracts structured text layer elements. Scanned documents or image-only pages must be OCR-processed before they can be read.

> [!CAUTION]
> **Exposure Risk**: The backend proxy is a lightweight API helper. If you deploy it to the public internet, ensure it sits behind a secure gateway (e.g., Nginx, Traefik, or Cloudflare Tunnel) to protect endpoints from unauthorized requests.

---

## 📄 License

This repository is licensed under the [MIT License](LICENSE). Feel free to modify, distribute, and integrate it into your personal or professional workflows.

