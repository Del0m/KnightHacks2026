ALTER TABLE "sessions" ADD COLUMN "export_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "export_started_at" timestamp with time zone;
