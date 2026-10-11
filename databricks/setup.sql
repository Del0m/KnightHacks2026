-- CONN-01: Unity Catalog objects for SteadyForum (Databricks Free Edition)
-- Run in the SQL Editor with "Run all". Safe to re-run.

-- Catalog and schemas (default storage)
CREATE CATALOG IF NOT EXISTS steadyforum;

CREATE SCHEMA IF NOT EXISTS steadyforum.raw  COMMENT 'Landing volume, bronze and silver tables';
CREATE SCHEMA IF NOT EXISTS steadyforum.ml   COMMENT 'MLflow models and training features';
CREATE SCHEMA IF NOT EXISTS steadyforum.gold COMMENT 'Gold tables synced to Neon, dashboards, Genie';

-- Landing zone for API uploads (CONN-02)
--   meta/   session metadata JSON
--   joints/ gzip'd per-frame joints
CREATE VOLUME IF NOT EXISTS steadyforum.raw.sessions;

-- API service principal (steadyforum-api)
-- Replace <steadyforum-api-application-id> with the SP's Application ID
-- (Settings -> Identity and access -> Service principals).
GRANT USE CATALOG ON CATALOG steadyforum TO `<steadyforum-api-application-id>`;

-- Upload sessions
GRANT USE SCHEMA ON SCHEMA steadyforum.raw TO `<steadyforum-api-application-id>`;
GRANT READ VOLUME, WRITE VOLUME ON VOLUME steadyforum.raw.sessions TO `<steadyforum-api-application-id>`;

-- Read gold tables for the Neon sync
GRANT USE SCHEMA, SELECT ON SCHEMA steadyforum.gold TO `<steadyforum-api-application-id>`;

-- Not scriptable here, do in the UI:
--   SQL Warehouses -> <warehouse> -> Permissions -> steadyforum-api: Can use
--   Service principal page -> Secrets -> Generate secret (OAuth M2M), store in apps/api/.env
