# Chat With This Page

Chrome extension (Manifest V3) that lets you chat with the content of the current webpage,
backed by a FastAPI proxy server that forwards requests to Groq. Containerized with Docker,
deployed to AWS EC2, auto-deployed via GitHub Actions on every push to `main`.

## Layout

- `extension/` — the Chrome extension (popup, content script, background service worker, options page)
- `backend/` — FastAPI proxy (`/chat` streaming endpoint, `/health` for monitoring)
- `docker-compose.yml` — runs the backend + Uptime Kuma on the EC2 host
- `deploy/ec2-setup.sh` — one-time bootstrap script for a fresh EC2 instance
- `.github/workflows/deploy.yml` — CI/CD: build, tag, push image, redeploy to EC2

## Local development

Backend:

```bash
cd backend
cp .env.example .env   # fill in GROQ_API_KEY
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload
```

Or with Docker:

```bash
cd backend
docker build -t chatwithpage-backend .
docker run --env-file .env -p 8000:8000 chatwithpage-backend
```

Extension: open `chrome://extensions`, enable Developer Mode, "Load unpacked", select the
`extension/` folder. Open its Options page to point `Backend URL` at
`http://localhost:8000` (default) or your deployed EC2 address.

## Deployment

See the CI/CD workflow in `.github/workflows/deploy.yml`. Pushing to `main` builds a new
image tagged with the git SHA and `latest`, pushes to Docker Hub, then redeploys it on EC2.
Push a tag like `v1.2.0` to also publish that semver tag for explicit version tracking.
