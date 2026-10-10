-- CONN-06 / CONN-08 compatibility: progress_daily for the gold-table sync, and doc_chunks in the
-- shape rag/ingest.ts writes (stable text ids, content hash).
CREATE TABLE "progress_daily" (
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"exercise_id" text NOT NULL,
	"sets" integer,
	"reps" integer,
	"clean_reps" integer,
	"clean_share" real,
	"volume_kg" real,
	"avg_range_deg" real,
	"avg_quality" real,
	"est_1rm_kg" real,
	"is_pr" boolean,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_daily_user_id_date_exercise_id_pk" PRIMARY KEY("user_id","date","exercise_id")
);
--> statement-breakpoint
ALTER TABLE "doc_chunks" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "doc_chunks" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
-- Default lets this apply to a table that already has rows; CONN-08 re-embeds them on its next run.
ALTER TABLE "doc_chunks" ADD COLUMN "content_hash" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "doc_chunks" ALTER COLUMN "content_hash" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "doc_chunks" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "progress_daily" ADD CONSTRAINT "progress_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_chunks_metadata_gin" ON "doc_chunks" USING gin ("metadata");