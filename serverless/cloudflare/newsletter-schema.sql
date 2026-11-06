-- Base de la lettre de veille (NEWSLETTER_DB).
--
-- Strictement séparée de LEADS_DB et de CONVERSION_DB : une demande commerciale
-- n'entre jamais ici. Aucun jeton n'y figure en clair, seule son empreinte.
CREATE TABLE IF NOT EXISTS newsletter_consents (
 email TEXT PRIMARY KEY,
 consent_id TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL,
 -- Preuve du consentement : version de l'information, origine, horodatage, sceau.
 notice_version TEXT NOT NULL,
 consent_source TEXT NOT NULL,
 request_at TEXT NOT NULL,
 confirmed_at TEXT,
 revoked_at TEXT,
 consent_proof TEXT,
 preferences TEXT NOT NULL DEFAULT '[]',
 confirmation_nonce TEXT NOT NULL,
 confirmation_digest TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 management_digest TEXT,
 management_expires_at INTEGER,
 -- Suivi des échecs de répercussion chez le fournisseur.
 sync_attempts INTEGER NOT NULL DEFAULT 0,
 sync_error TEXT,
 sync_attempt_at TEXT
);
CREATE INDEX IF NOT EXISTS newsletter_confirmation ON newsletter_consents (confirmation_digest);
CREATE INDEX IF NOT EXISTS newsletter_management ON newsletter_consents (management_digest);
CREATE INDEX IF NOT EXISTS newsletter_state ON newsletter_consents (state, expires_at);
