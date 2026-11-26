CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  redirect_uris TEXT NOT NULL
);

CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  redirect_uri TEXT NOT NULL,
  resource TEXT NOT NULL,
  challenge TEXT NOT NULL,
  code_hash TEXT UNIQUE,
  access_hash TEXT UNIQUE,
  refresh_hash TEXT UNIQUE,
  access_expires_at INTEGER,
  expires_at INTEGER NOT NULL
);

CREATE INDEX oauth_grants_expiry_idx ON oauth_grants (expires_at);
