-- Runs once, when the pgdata volume is first created. The backend also ensures this on every startup.
CREATE EXTENSION IF NOT EXISTS vector;
