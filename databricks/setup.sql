-- CONN-01: Unity Catalog objects for Spotter (Databricks Free Edition)
-- Run in the SQL Editor with "Run all". Safe to re-run.

-- Catalog and schemas (default storage)
CREATE CATALOG IF NOT EXISTS spotter;

CREATE SCHEMA IF NOT EXISTS spotter.raw  COMMENT 'Landing volume, bronze and silver tables';
CREATE SCHEMA IF NOT EXISTS spotter.ml   COMMENT 'MLflow models and training features';
CREATE SCHEMA IF NOT EXISTS spotter.gold COMMENT 'Gold tables synced to Neon, dashboards, Genie';

-- Landing zone for API uploads (CONN-02)
--   meta/   session metadata JSON
--   joints/ gzip'd per-frame joints
CREATE VOLUME IF NOT EXISTS spotter.raw.sessions;

-- API service principal (spotter-api)
-- Replace <spotter-api-application-id> with the SP's Application ID
-- (Settings -> Identity and access -> Service principals).
GRANT USE CATALOG ON CATALOG spotter TO `<spotter-api-application-id>`;

-- Upload sessions
GRANT USE SCHEMA ON SCHEMA spotter.raw TO `<spotter-api-application-id>`;
GRANT READ VOLUME, WRITE VOLUME ON VOLUME spotter.raw.sessions TO `<spotter-api-application-id>`;

-- Read gold tables for the Neon sync
GRANT USE SCHEMA, SELECT ON SCHEMA spotter.gold TO `<spotter-api-application-id>`;

-- Injury-risk model outputs (AI-14). Already covered by the schema grant above; explicit so the
-- API's model-first sync keeps working if that grant is narrowed. These tables are written by
-- notebooks/risk_model.py, so these two lines fail until it has run once: re-run them after.
GRANT SELECT ON TABLE spotter.gold.gold_injury_risk_model_scores TO `<spotter-api-application-id>`;
GRANT SELECT ON TABLE spotter.gold.gold_risk_feature_importance TO `<spotter-api-application-id>`;

-- Not scriptable here, do in the UI:
--   SQL Warehouses -> <warehouse> -> Permissions -> spotter-api: Can use
--   Service principal page -> Secrets -> Generate secret (OAuth M2M), store in apps/api/.env
