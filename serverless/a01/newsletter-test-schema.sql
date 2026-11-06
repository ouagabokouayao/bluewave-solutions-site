-- Même structure que newsletter-schema.sql, isolée pour les tests.
--
-- Strictement séparée de LEADS_DB et de CONVERSION_DB : une demande commerciale
-- n'entre jamais ici. Aucun jeton n'y figure en clair, seule son empreinte.
CREATE TABLE newsletter_test_consents (
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
 management_expires_at INTEGER
);
