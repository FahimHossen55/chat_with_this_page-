import httpx
import respx


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chat_unknown_provider_returns_400(client):
    response = client.post(
        "/chat",
        json={
            "provider": "bogus",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert response.status_code == 400
    assert "Unknown provider" in response.json()["detail"]


def test_chat_missing_api_key_returns_500(client, monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    response = client.post(
        "/chat",
        json={
            "provider": "groq",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert response.status_code == 500
    assert "GROQ_API_KEY" in response.json()["detail"]


@respx.mock
def test_chat_success_streams_sse(client, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    sse_body = (
        b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
        b"data: [DONE]\n\n"
    )
    respx.post("https://api.groq.com/openai/v1/chat/completions").mock(
        return_value=httpx.Response(200, content=sse_body)
    )

    response = client.post(
        "/chat",
        json={
            "provider": "groq",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )

    assert response.status_code == 200
    assert b"Hello" in response.content
