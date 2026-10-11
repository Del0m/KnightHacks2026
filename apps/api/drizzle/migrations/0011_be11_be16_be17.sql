CREATE TYPE "public"."milestone_status" AS ENUM('pending', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"rehab_plan_id" uuid NOT NULL,
	"status" "milestone_status" DEFAULT 'pending' NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hidden_until" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"rehab_plan_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_shares_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "report_shares_range" CHECK ("report_shares"."to_date" >= "report_shares"."from_date")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "sources" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "embedding" vector(384);--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_rehab_plan_id_rehab_plans_id_fk" FOREIGN KEY ("rehab_plan_id") REFERENCES "public"."rehab_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_rehab_plan_id_rehab_plans_id_fk" FOREIGN KEY ("rehab_plan_id") REFERENCES "public"."rehab_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "milestones_user_idx" ON "milestones" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "report_shares_user_idx" ON "report_shares" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_embedding_idx" ON "posts" USING hnsw ("embedding" vector_cosine_ops);