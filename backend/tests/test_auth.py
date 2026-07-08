import urllib.parse
import respx
import httpx
from fastapi.testclient import TestClient
from app.main import app

def test_secure_endpoints_enforce_auth():
    # Create client without conftest's get_current_user override
    client = TestClient(app)
    
    # 1. Literature search should return 403
    res = client.get("/literature/search?query=test")
    assert res.status_code == 403
    assert "not authenticated" in res.json()["detail"].lower()
    
    # 2. Chat should return 403
    res = client.post("/chat", json={
        "provider": "groq",
        "messages": [{"role": "user", "content": "hi"}]
    })
    assert res.status_code == 403

def test_login_flow_redirects(monkeypatch):
    monkeypatch.setattr("app.main.GOOGLE_CLIENT_ID", "real-google-client-id.apps.googleusercontent.com")
    client = TestClient(app)
    # Valid Chrome Extension redirect URI
    redirect_uri = "https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/"
    res = client.get(f"/auth/login?redirect_uri={redirect_uri}", follow_redirects=False)
    assert res.status_code == 307
    assert "accounts.google.com" in res.headers["location"]
    assert "state=" in res.headers["location"]

def test_login_invalid_redirect_uri():
    client = TestClient(app)
    # Invalid redirect URI (open redirect target)
    res = client.get("/auth/login?redirect_uri=https://google.com")
    assert res.status_code == 400
    assert "Invalid redirect_uri" in res.json()["detail"]

def test_callback_mock_flow():
    client = TestClient(app)
    
    # First get the state from a login request
    redirect_uri = "https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/"
    login_res = client.get(f"/auth/login?redirect_uri={redirect_uri}", follow_redirects=False)
    auth_url = login_res.headers["location"]
    
    # Extract state parameter from redirect location
    parsed_url = urllib.parse.urlparse(auth_url)
    query_params = urllib.parse.parse_qs(parsed_url.query)
    state = query_params["state"][0]
    
    # Call callback with mock code and valid state
    callback_res = client.get(f"/auth/callback?code=mock_code_123&state={state}", follow_redirects=False)
    assert callback_res.status_code == 307
    
    # Validate final redirect has token, name, email and picture parameters
    target_url = callback_res.headers["location"]
    assert target_url.startswith(redirect_uri)
    
    parsed_target = urllib.parse.urlparse(target_url)
    target_params = urllib.parse.parse_qs(parsed_target.query)
    assert "token" in target_params
    assert target_params["email"][0] == "test.user@example.com"
    assert target_params["name"][0] == "Test User"
    
    # Verify we can make requests to a secure endpoint with the token
    token = target_params["token"][0]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Mock literature trending API call
    with respx.mock:
        respx.get("https://api.semanticscholar.org/graph/v1/paper/trending").mock(
            return_value=httpx.Response(200, json={"data": []})
        )
        trending_res = client.get("/literature/trending?limit=5", headers=headers)
        assert trending_res.status_code == 200
