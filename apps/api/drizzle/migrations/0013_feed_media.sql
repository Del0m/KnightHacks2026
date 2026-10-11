CREATE TYPE "public"."media_kind" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('pending', 'attached');--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"post_id" uuid,
	"position" integer,
	"kind" "media_kind" NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"storage_key" text NOT NULL,
	"status" "media_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp with time zone,
	CONSTRAINT "media_storageKey_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_size_positive" CHECK ("media"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "post_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_reports_post_reporter_uq" UNIQUE("post_id","reporter_id")
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_post_idx" ON "media" USING btree ("post_id","position");--> statement-breakpoint
CREATE INDEX "media_pending_idx" ON "media" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "post_reports_post_idx" ON "post_reports" USING btree ("post_id");