-- Stockage newsletter isolé de LEADS_DB et CONVERSION_DB. Tests uniquement.
CREATE TABLE newsletter_test_consents (
 email TEXT PRIMARY KEY,
 consent_id TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL,
 notice_version TEXT NOT NULL,
 consent_source TEXT NOT NULL,
 request_at TEXT NOT NULL,
 confirmed_at TEXT,
 revoked_at TEXT,
 preferences TEXT NOT NULL DEFAULT '[]',
 confirmation_nonce TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 management_nonce TEXT
);
