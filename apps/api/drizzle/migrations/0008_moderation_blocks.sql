CREATE TYPE "public"."moderated_kind" AS ENUM('post', 'comment');--> statement-breakpoint
CREATE TABLE "moderation_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" text NOT NULL,
	"kind" "moderated_kind" NOT NULL,
	"post_id" uuid,
	"body" text NOT NULL,
	"categories" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moderation_blocks" ADD CONSTRAINT "moderation_blocks_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_blocks" ADD CONSTRAINT "moderation_blocks_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_blocks_author_created_idx" ON "moderation_blocks" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "moderation_blocks_post_idx" ON "moderation_blocks" USING btree ("post_id");