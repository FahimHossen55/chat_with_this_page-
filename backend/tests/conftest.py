import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.auth import get_current_user
from app.database import Base, get_db, User

# SQLite file-based database for testing to ensure persistence
TEST_DATABASE_URL = "sqlite:///./test.db"
test_engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

# Create all tables on the SQLite test database
Base.metadata.create_all(bind=test_engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# Globally override database connection for all tests to use SQLite in-memory
app.dependency_overrides[get_db] = override_get_db


@pytest.fixture
def client():
    # Mock user for authentication bypass during testing
    mock_user = User(
        id="test-uuid-12345",
        google_id="google-mock-test",
        email="test.user@example.com",
        name="Test User",
        picture="https://lh3.googleusercontent.com/a/default-user"
    )
    
    # Pre-populate mock user in the SQLite test database
    db = TestingSessionLocal()
    if not db.query(User).filter(User.email == mock_user.email).first():
        db.add(mock_user)
        db.commit()
    db.close()

    # Override current user mock for standard tests
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield TestClient(app)
    # Remove mock user override but keep global get_db override
    app.dependency_overrides.pop(get_current_user, None)
