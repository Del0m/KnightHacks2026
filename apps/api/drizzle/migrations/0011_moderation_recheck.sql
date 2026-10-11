ALTER TABLE "comments" ADD COLUMN "moderation_checked" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderation_checked" boolean DEFAULT true NOT NULL;