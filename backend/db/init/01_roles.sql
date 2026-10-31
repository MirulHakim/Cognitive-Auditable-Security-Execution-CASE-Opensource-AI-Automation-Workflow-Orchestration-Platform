-- CASE — development database setup (runs ONCE, when the Docker volume is first created)
--
-- Docker's postgres image runs every file in /docker-entrypoint-initdb.d as the
-- superuser `postgres`. With a native Postgres install, run this file once
-- yourself:  psql -U postgres -f backend/db/init/01_roles.sql
--
-- The passwords are for local development only. Real deployments set their own.

CREATE ROLE case_owner LOGIN PASSWORD 'case_owner_dev';   -- owns the tables, runs migrations
CREATE ROLE case_app   LOGIN PASSWORD 'case_app_dev';     -- the app connects as this

-- "case" is an SQL keyword, hence case_dev. Tests create their own case_test.
CREATE DATABASE case_dev OWNER case_owner;
