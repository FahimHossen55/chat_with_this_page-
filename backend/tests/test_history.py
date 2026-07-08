import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, engine, User, ChatHistory
from app.auth import create_access_token
from tests.conftest import TestingSessionLocal

@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def db_session():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_auth_headers(email: str = "test.user@example.com"):
    # Generate token
    token = create_access_token(data={"email": email})
    return {"Authorization": f"Bearer {token}"}

def test_unauthorized_history_endpoints():
    client = TestClient(app)
    
    # Missing authorization header should return 403 Forbidden
    res = client.get("/chat/history")
    assert res.status_code == 403

    res = client.post("/chat/history", json={
        "url": "https://example.com/page",
        "title": "Example Page",
        "messages": []
    })
    assert res.status_code == 403

    res = client.delete("/chat/history?url=https://example.com/page")
    assert res.status_code == 403

def test_post_and_get_chat_history(db_session):
    client = TestClient(app)
    headers = get_auth_headers()
    
    # 1. Ensure the user exists in the database first so the foreign key doesn't fail
    user = db_session.query(User).filter(User.email == "test.user@example.com").first()
    if not user:
        user = User(id="test-uuid-12345", google_id="google-12345", email="test.user@example.com", name="Test User")
        db_session.add(user)
        db_session.commit()

    # 2. Post a conversation
    res = client.post("/chat/history", headers=headers, json={
        "url": "https://example.com/scientific-article",
        "title": "Quantum Computing Basics",
        "messages": [
            {"role": "user", "content": "What is superposition?"},
            {"role": "assistant", "content": "It is a fundamental principle of quantum mechanics."}
        ]
    })
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    # 3. Retrieve history and assert correctness
    res = client.get("/chat/history", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data["history"]) == 1
    assert data["history"][0]["url"] == "https://example.com/scientific-article"
    assert data["history"][0]["title"] == "Quantum Computing Basics"
    assert len(data["history"][0]["messages"]) == 2
    assert data["history"][0]["messages"][0]["content"] == "What is superposition?"

def test_update_and_delete_chat_history(db_session):
    client = TestClient(app)
    headers = get_auth_headers()

    # 1. Ensure the user exists in the database
    user = db_session.query(User).filter(User.email == "test.user@example.com").first()
    if not user:
        user = User(id="test-uuid-12345", google_id="google-12345", email="test.user@example.com", name="Test User")
        db_session.add(user)
        db_session.commit()

    url = "https://example.com/scientific-article"

    # 2. Post a conversation
    client.post("/chat/history", headers=headers, json={
        "url": url,
        "title": "Version 1",
        "messages": [{"role": "user", "content": "hello"}]
    })

    # 3. Update the conversation with new message
    client.post("/chat/history", headers=headers, json={
        "url": url,
        "title": "Version 2",
        "messages": [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
            {"role": "user", "content": "how are you?"}
        ]
    })

    # Assert it updated correctly
    res = client.get("/chat/history", headers=headers)
    assert len(res.json()["history"]) == 1
    assert res.json()["history"][0]["title"] == "Version 2"
    assert len(res.json()["history"][0]["messages"]) == 3

    # 4. Delete the conversation
    res = client.delete(f"/chat/history?url={url}", headers=headers)
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    # Verify list is now empty
    res = client.get("/chat/history", headers=headers)
    assert len(res.json()["history"]) == 0
