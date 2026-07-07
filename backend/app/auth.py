import os
import time
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db, User

JWT_SECRET = os.getenv("JWT_SECRET", "super_secret_jwt_signing_key_for_research_os_123456")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

security = HTTPBearer()

def create_access_token(data: dict, expires_delta: float = 30 * 24 * 3600) -> str:
    """Create a signed JWT token containing user details, valid for 30 days by default."""
    payload = data.copy()
    payload["exp"] = int(time.time()) + expires_delta
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token

def verify_token(token: str) -> dict | None:
    """Verify the signature and expiration of a JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None

def generate_state_token(redirect_uri: str) -> str:
    """Generate a signed state token containing the redirect_uri to prevent CSRF and validate redirects."""
    payload = {
        "redirect_uri": redirect_uri,
        "nonce": os.urandom(16).hex(),
        "exp": int(time.time()) + 600  # 10 minutes expiry
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_state_token(state_token: str) -> str | None:
    """Verify and decode state token, returning the redirect_uri if valid."""
    try:
        payload = jwt.decode(state_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("redirect_uri")
    except jwt.PyJWTError:
        return None

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)) -> User:
    """Dependency to retrieve and authorize the current user using the Bearer token."""
    token = credentials.credentials
    payload = verify_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    email = payload.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload missing email parameter",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not registered on the system",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user
