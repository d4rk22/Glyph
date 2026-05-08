CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  admin_user_id TEXT,
  username TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX webauthn_challenges_challenge_idx ON webauthn_challenges (challenge);
CREATE INDEX webauthn_challenges_expires_at_idx ON webauthn_challenges (expires_at);

