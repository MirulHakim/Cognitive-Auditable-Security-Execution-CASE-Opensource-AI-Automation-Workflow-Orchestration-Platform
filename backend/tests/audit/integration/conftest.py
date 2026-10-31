"""
Fixtures for the PostgreSQL integration tests (Audit Phase 3).

Once per pytest run: drop and re-create the database `case_test`, apply
backend/migrations as case_owner. Each test then gets its own random
workspace, and chains are per workspace, so tests never see each other's
events and nothing has to be deleted between tests.

Three connections, like a real deployment:
  app    case_app    what the application uses (INSERT/SELECT only)
  owner  case_owner  owns the tables (runs migrations)
  admin  postgres    superuser; used only to create the test DB and to
                     simulate an attacker with full database access

If Postgres cannot be reached, every test here is skipped with the reason.
Settings (defaults match docker-compose.yml):
  CASE_TEST_ADMIN_URL       postgresql://postgres:postgres@localhost:5432/postgres
  CASE_TEST_OWNER_PASSWORD  case_owner_dev
  CASE_TEST_APP_PASSWORD    case_app_dev
"""

import asyncio
import os
from dataclasses import dataclass
from uuid import uuid4

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from src.audit.repository import PostgresAuditRepository
from src.audit.service import AuditService
from src.storage.database import Database
from src.storage.migrate import apply_migrations

ADMIN_URL = os.environ.get("CASE_TEST_ADMIN_URL", "postgresql://postgres:postgres@localhost:5432/postgres")
OWNER_PASSWORD = os.environ.get("CASE_TEST_OWNER_PASSWORD", "case_owner_dev")
APP_PASSWORD = os.environ.get("CASE_TEST_APP_PASSWORD", "case_app_dev")
TEST_DB = "case_test"


@dataclass(frozen=True)
class PgUrls:
    admin: str
    owner: str
    app: str


@pytest.fixture(scope="session")
def pg_urls() -> PgUrls:
    where = "{host}:{port}".format(**{"host": "localhost", "port": "5432", **conninfo_to_dict(ADMIN_URL)})
    try:
        admin = psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError:
        pytest.skip(f"PostgreSQL not reachable at {where}; start it with `docker compose up -d`")
    with admin:
        roles = {row[0] for row in admin.execute(
            "SELECT rolname FROM pg_roles WHERE rolname IN ('case_owner', 'case_app')")}
        if roles != {"case_owner", "case_app"}:
            pytest.skip("roles case_owner / case_app are missing: run backend/db/init/01_roles.sql as postgres")
        admin.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        admin.execute(f"CREATE DATABASE {TEST_DB} OWNER case_owner")

    urls = PgUrls(
        admin=make_conninfo(ADMIN_URL, dbname=TEST_DB),
        owner=make_conninfo(ADMIN_URL, dbname=TEST_DB, user="case_owner", password=OWNER_PASSWORD),
        app=make_conninfo(ADMIN_URL, dbname=TEST_DB, user="case_app", password=APP_PASSWORD),
    )
    apply_migrations(urls.owner)
    with psycopg.connect(urls.owner, autocommit=True) as owner:
        # Stand-in for another module's table (e.g. Amirul's whitelist), test DB only:
        # used by the pattern A tests.
        owner.execute("""
            CREATE TABLE whitelist_entries (
                entry_id     uuid     PRIMARY KEY,
                workspace_id uuid     NOT NULL,
                sender_hash  char(64) NOT NULL
            );
            GRANT SELECT, INSERT ON whitelist_entries TO case_app;
        """)
    return urls


@pytest.fixture
def anyio_backend():
    """psycopg's async mode cannot run on Windows' default ProactorEventLoop."""
    return "asyncio", {"loop_factory": asyncio.SelectorEventLoop}


@pytest.fixture
async def db(pg_urls):
    async with Database(pg_urls.app, max_size=10) as database:
        yield database


@pytest.fixture
def pg_repo(db) -> PostgresAuditRepository:
    return PostgresAuditRepository(db)


@pytest.fixture
def pg_service(pg_repo) -> AuditService:
    # Real clock and random ids: every test writes to the same database.
    return AuditService(pg_repo)


@pytest.fixture
def ws() -> str:
    """A fresh workspace (= a fresh, empty chain) for each test."""
    return str(uuid4())


def run_sql(url: str, query: str, params=None, *, bypass_triggers: bool = False):
    """Run one statement in its own committed transaction; return the rows, if any.

    bypass_triggers (superuser only) is how someone with full database access
    gets past the 002 triggers: the attacker the hash chain is there to catch.
    """
    with psycopg.connect(url) as conn:
        if bypass_triggers:
            conn.execute("SET LOCAL session_replication_role = replica")
        cur = conn.execute(query, params)
        return cur.fetchall() if cur.description else None
