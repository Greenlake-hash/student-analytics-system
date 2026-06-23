"""
Shared pytest fixtures.

Tests run against the same local Postgres instance as development
(backend/.env's DATABASE_URL), inside a transaction that's rolled back
after each test -- so tests never leave junk data behind and never need
their own database server.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import engine, get_db
from app.main import app


@pytest.fixture()
def db_session() -> Session:
    """
    Yields a SQLAlchemy session bound to a connection wrapped in an outer
    transaction. Everything the test does is rolled back at teardown,
    regardless of whether the test itself calls commit() or rollback().
    """
    connection = engine.connect()
    transaction = connection.begin()
    TestSessionLocal = sessionmaker(bind=connection, autoflush=False, autocommit=False, future=True)
    session = TestSessionLocal()

    try:
        yield session
    finally:
        session.close()
        if transaction.is_active:
            transaction.rollback()
        connection.close()


@pytest.fixture()
def client(db_session: Session) -> TestClient:
    """
    A TestClient whose `get_db` dependency is overridden to hand out the
    SAME transaction-wrapped session as the db_session fixture, so test
    setup (e.g. creating a Course directly via db_session) and the
    request the test makes against the API see the same uncommitted data,
    and everything rolls back together at teardown.
    """
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
