-- Base métier des demandes (LEADS_DB).
--
-- Strictement séparée de CONVERSION_DB, qui ne porte que des compteurs
-- d'événements agrégés sans donnée personnelle. Les deux bases ne partagent
-- ni binding, ni table, ni jointure : une demande nominative n'entre jamais
-- dans les agrégats, un agrégat n'entre jamais ici.
--
-- Ne sont jamais stockés dans cette base : adresse IP brute, jeton Turnstile,
-- clé d'API, secret, en-tête de requête, ou texte libre d'analytics.

CREATE TABLE IF NOT EXISTS lead_records (
 id TEXT PRIMARY KEY,
 -- Empreinte métier de la demande : deux envois identiques le même jour
 -- produisent une seule ligne, donc un seul accusé.
 idempotency_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,

 -- Qualification : ces colonnes restent requêtables une par une.
 journey TEXT NOT NULL,
 source_offer TEXT NOT NULL DEFAULT '',
 recommended_offer TEXT NOT NULL DEFAULT '',
 lead_type TEXT NOT NULL,
 organisation_type TEXT NOT NULL DEFAULT '',
 territory TEXT NOT NULL DEFAULT '',
 need_category TEXT NOT NULL DEFAULT '',
 stage TEXT NOT NULL DEFAULT '',
 data_availability TEXT NOT NULL DEFAULT '',
 desired_outcome TEXT NOT NULL DEFAULT '',
 deadline TEXT NOT NULL DEFAULT '',
 contact_preference TEXT NOT NULL DEFAULT '',

 -- Identité nécessaire à la réponse.
 firstname TEXT NOT NULL,
 lastname TEXT NOT NULL,
 email TEXT NOT NULL,
 organisation TEXT NOT NULL DEFAULT '',
 role TEXT NOT NULL DEFAULT '',

 -- Charge métier propre au parcours, bornée par le schéma P0 : les champs
 -- longs et spécifiques (besoin, attente, motivation, objectifs…) y sont
 -- sérialisés plutôt que d'aplatir la table sur quarante colonnes creuses.
 journey_payload TEXT NOT NULL DEFAULT '{}',

 -- Cycle TECHNIQUE de la demande. Ne dit rien de l'intérêt commercial.
 delivery_status TEXT NOT NULL DEFAULT 'RECEIVED',
 -- Cycle de QUALIFICATION, renseigné à la main. Pour le vivier d'expertise,
 -- seul l'un de REÇU / À QUALIFIER / QUALIFIÉ / À CONTACTER. Aucun statut
 -- n'est jamais promu automatiquement.
 qualification_status TEXT NOT NULL DEFAULT '',

 brevo_contact_status TEXT NOT NULL DEFAULT 'PENDING',
 ack_status TEXT NOT NULL DEFAULT 'PENDING',
 notification_status TEXT NOT NULL DEFAULT 'PENDING',

 -- Code d'échec court et non personnel, pour le rapprochement manuel.
 last_error_code TEXT NOT NULL DEFAULT '',
 -- Identifiant de corrélation technique, sans lien avec une personne.
 correlation_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS lead_records_created_at ON lead_records (created_at);
CREATE INDEX IF NOT EXISTS lead_records_delivery ON lead_records (delivery_status, created_at);
CREATE INDEX IF NOT EXISTS lead_records_journey ON lead_records (journey, lead_type, created_at);
CREATE INDEX IF NOT EXISTS lead_records_territory ON lead_records (territory, need_category);
CREATE INDEX IF NOT EXISTS lead_records_email ON lead_records (email);
