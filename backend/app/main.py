import json
import logging
import os
import time

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.providers import get_provider

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
async def chat(req: ChatRequest):
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
                    raise HTTPException(
                        status_code=upstream.status_code,
                        detail=body.decode(errors="replace"),
                    )
                async for chunk in upstream.aiter_bytes():
                    yield chunk
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
