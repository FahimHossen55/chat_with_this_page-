import os
import uuid
from datetime import datetime
from sqlalchemy import create_engine, Column, String, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:changeme@db:5432/chatwithpage")

# Create SQLAlchemy engine
engine = create_engine(DATABASE_URL)

# Configure database session pool
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Declarative base class for models
Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary key=True, default=lambda: str(uuid.uuid4()))
    google_id = Column(String(255), unique=True, index=True, nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=True)
    picture = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# Dependency generator to obtain a db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Helper to automatically create all tables
def init_db():
    Base.metadata.create_all(bind=engine)
