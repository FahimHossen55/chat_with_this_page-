import asyncio
import json
import logging
import os
import time

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
import urllib.parse

from app.providers import get_provider
from app import literature
from app import datasets
from app.database import get_db, init_db, User
from app.auth import (
    get_current_user,
    create_access_token,
    generate_state_token,
    verify_state_token,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
)

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("chatwithpage")

app = FastAPI(title="Chat With This Page — Proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*|http://localhost(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/auth/login")
async def auth_login(redirect_uri: str):
    # Validate redirect_uri to prevent open redirects (only allow chrome extensions)
    if not redirect_uri.startswith("https://") or not redirect_uri.endswith(".chromiumapp.org/"):
        raise HTTPException(status_code=400, detail="Invalid redirect_uri. Must be a secure Chrome Extension URL.")
    
    # Generate state token containing the redirect_uri
    state = generate_state_token(redirect_uri)
    
    google_oauth_url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={GOOGLE_CLIENT_ID}"
        "&redirect_uri=http://localhost:8000/auth/callback"
        "&response_type=code"
        "&scope=openid%20email%20profile"
        f"&state={state}"
    )
    return RedirectResponse(google_oauth_url)


@app.get("/auth/callback")
async def auth_callback(code: str, state: str, db: Session = Depends(get_db)):
    # Verify state and retrieve redirect_uri
    redirect_uri = verify_state_token(state)
    if not redirect_uri:
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")
    
    # Check if we are running in simulated mock mode for local setup convenience
    if GOOGLE_CLIENT_ID == "dummy_client_id.apps.googleusercontent.com" or code.startswith("mock_code_"):
        email = "test.user@example.com"
        name = "Test User"
        picture = "https://lh3.googleusercontent.com/a/default-user"
        google_id = f"google-mock-{code}"
    else:
        # Live Google token exchange
        token_url = "https://oauth2.googleapis.com/token"
        payload = {
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": "http://localhost:8000/auth/callback",
            "grant_type": "authorization_code"
        }
        async with httpx.AsyncClient() as client:
            token_res = await client.post(token_url, data=payload)
            if token_res.status_code >= 400:
                raise HTTPException(status_code=400, detail=f"Google code exchange failed: {token_res.text}")
            
            tokens = token_res.json()
            access_token = tokens.get("access_token")
            if not access_token:
                raise HTTPException(status_code=400, detail="Token response did not include access_token")
            
            # Fetch user info
            userinfo_url = "https://www.googleapis.com/oauth2/v3/userinfo"
            headers = {"Authorization": f"Bearer {access_token}"}
            userinfo_res = await client.get(userinfo_url, headers=headers)
            if userinfo_res.status_code >= 400:
                raise HTTPException(status_code=400, detail="Google userinfo request failed")
            
            userinfo = userinfo_res.json()
            email = userinfo.get("email")
            name = userinfo.get("name")
            picture = userinfo.get("picture")
            google_id = userinfo.get("sub")
            
            if not email:
                raise HTTPException(status_code=400, detail="Google response lacks email address")

    # Upsert user record
    user = db.query(User).filter(User.google_id == google_id).first()
    if not user:
        # Fallback query on email
        user = db.query(User).filter(User.email == email).first()
        if user:
            user.google_id = google_id
            if name:
                user.name = name
            if picture:
                user.picture = picture
        else:
            user = User(
                google_id=google_id,
                email=email,
                name=name,
                picture=picture
            )
            db.add(user)
    else:
        if name:
            user.name = name
        if picture:
            user.picture = picture
            
    db.commit()
    db.refresh(user)
    
    # Generate application session JWT
    token_data = {
        "sub": user.id,
        "email": user.email,
        "name": user.name
    }
    jwt_token = create_access_token(token_data)
    
    # Redirect back to extension redirect uri with token
    redirect_url = (
        f"{redirect_uri}"
        f"?token={urllib.parse.quote(jwt_token)}"
        f"&email={urllib.parse.quote(user.email)}"
        f"&name={urllib.parse.quote(user.name or '')}"
        f"&picture={urllib.parse.quote(user.picture or '')}"
    )
    return RedirectResponse(redirect_url)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    provider: str = "groq"
    model: str | None = None
    messages: list[ChatMessage]
    stream: bool = True


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/chat")
async def chat(req: ChatRequest, current_user: User = Depends(get_current_user)):
    try:
        provider = get_provider(req.provider)
    except KeyError as e:
        raise HTTPException(status_code=400, detail=str(e))

    api_key = os.environ.get(provider["key_env"])
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail=f"Missing {provider['key_env']} on the server",
        )

    model = req.model or provider["default_model"]
    payload = {
        "model": model,
        "messages": [m.model_dump() for m in req.messages],
        "stream": req.stream,
    }
    headers = {"Authorization": f"Bearer {api_key}"}

    start = time.monotonic()
    client = httpx.AsyncClient(timeout=60.0)

    async def event_stream():
        status = "error"
        try:
            async with client.stream(
                "POST", provider["chat_url"], json=payload, headers=headers
            ) as upstream:
                status = str(upstream.status_code)
                if upstream.status_code >= 400:
                    body = await upstream.aread()
                    err_msg = body.decode(errors="replace")
                    try:
                        parsed_err = json.loads(err_msg)
                        if "error" in parsed_err and "message" in parsed_err["error"]:
                            err_msg = parsed_err["error"]["message"]
                        elif "detail" in parsed_err:
                            err_msg = parsed_err["detail"]
                    except:
                        pass
                    yield f"data: {json.dumps({'error': f'LLM API Error ({upstream.status_code}): {err_msg}'})}\n\n"
                    return
                async for chunk in upstream.aiter_bytes():
                    yield chunk
        except Exception as e:
            err_msg = str(e)
            yield f"data: {json.dumps({'error': f'Connection error: {err_msg}'})}\n\n"
        finally:
            latency_ms = round((time.monotonic() - start) * 1000)
            logger.info(
                json.dumps(
                    {
                        "provider": req.provider,
                        "model": model,
                        "status": status,
                        "latency_ms": latency_ms,
                    }
                )
            )
            await client.aclose()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/literature/search")
async def literature_search(
    query: str,
    source: str = "all",
    sort: str | None = None,
    open_access: bool = False,
    year: str | None = None,
    limit: int = 10,
    offset: int = 0,
    ieee_api_key: str | None = None,
    serp_api_key: str | None = None,
    current_user: User = Depends(get_current_user)
):
    try:
        limit = min(limit, 30)
        if source == "arxiv":
            results = await literature.search_arxiv(query, offset, limit)
        elif source == "semanticscholar":
            results = await literature.search_semanticscholar(query, limit, offset, sort, open_access, year)
        elif source == "openalex":
            page = (offset // limit) + 1
            results = await literature.search_openalex(query, limit, page, sort, open_access, year)
        elif source == "ieee":
            results = await literature.search_ieee_xplore(query, ieee_api_key, limit, offset)
        elif source == "scholar":
            results = await literature.search_google_scholar(query, serp_api_key, limit, offset)
        elif source == "scientificdata":
            results = await literature.search_scientific_data(query, limit, offset)
        else:
            page = (offset // limit) + 1
            tasks = [
                literature.search_semanticscholar(query, limit, offset, sort, open_access, year),
                literature.search_arxiv(query, offset, limit),
                literature.search_openalex(query, limit, page, sort, open_access, year),
                literature.search_ieee_xplore(query, ieee_api_key, limit, offset),
                literature.search_google_scholar(query, serp_api_key, limit, offset),
                literature.search_scientific_data(query, limit, offset)
            ]
            raw_results = await asyncio.gather(*tasks, return_exceptions=True)
            
            results = []
            seen_titles = set()
            for r in raw_results:
                if isinstance(r, list):
                    for paper in r:
                        if paper.get("id") == "SCHOLAR_KEY_REQUIRED":
                            continue
                        title_key = paper["title"].lower().strip()
                        if title_key not in seen_titles:
                            seen_titles.add(title_key)
                            results.append(paper)
            
            if sort == "newest":
                results.sort(key=lambda x: x.get("year") or 0, reverse=True)
            elif sort == "citations":
                results.sort(key=lambda x: x.get("citationCount") or 0, reverse=True)
                
            results = results[:limit]
            
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/literature/similar")
async def literature_similar(paper_id: str, limit: int = 10, current_user: User = Depends(get_current_user)):
    try:
        limit = min(limit, 30)
        results = await literature.get_similar_papers(paper_id, limit)
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/literature/trending")
async def literature_trending(limit: int = 10, current_user: User = Depends(get_current_user)):
    try:
        limit = min(limit, 30)
        results = await literature.get_trending_papers(limit)
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/literature/author")
async def literature_author(query: str, current_user: User = Depends(get_current_user)):
    try:
        result = await literature.get_author_details(query)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/datasets/search")
async def datasets_search(
    query: str,
    source: str = "all",
    domain: str | None = None,
    task: str | None = None,
    modality: str | None = None,
    size: str | None = None,
    license: str | None = None,
    sort: str = "relevance",
    limit: int = 15,
    offset: int = 0,
    current_user: User = Depends(get_current_user)
):
    try:
        results = await datasets.search_datasets(
            query=query,
            source=source,
            domain=domain,
            task=task,
            modality=modality,
            size=size,
            license=license,
            sort=sort,
            limit=limit,
            offset=offset
        )
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


