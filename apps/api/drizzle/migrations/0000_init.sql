-- DB-08: pgvector for RAG chunks and profile embeddings. drizzle-kit does not emit extensions.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."body_part" AS ENUM('knee', 'shoulder', 'lower_back', 'hip', 'ankle', 'wrist', 'elbow', 'neck', 'other');--> statement-breakpoint
CREATE TYPE "public"."experience_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."injury_severity" AS ENUM('mild', 'moderate', 'severe');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('pending', 'uploading', 'exported', 'failed');--> statement-breakpoint
CREATE TYPE "public"."inference_mode" AS ENUM('on_device', 'cloud');--> statement-breakpoint
CREATE TYPE "public"."medal_tier" AS ENUM('bronze', 'silver', 'gold');--> statement-breakpoint
CREATE TYPE "public"."buddy_status" AS ENUM('requested', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."post_kind" AS ENUM('session', 'pr', 'medal', 'goal', 'advice');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'achieved', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."pr_metric" AS ENUM('max_weight_kg', 'max_reps', 'est_1rm_kg');--> statement-breakpoint
CREATE TABLE "injuries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"body_part" "body_part" NOT NULL,
	"severity" "injury_severity" DEFAULT 'mild' NOT NULL,
	"since" date,
	"notes" text,
	"is_private" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"experience_level" "experience_level" DEFAULT 'beginner' NOT NULL,
	"gym_place_id" text,
	"gym_name" text,
	"gym_lat" double precision,
	"gym_lng" double precision,
	"schedule" text[] DEFAULT '{}'::text[] NOT NULL,
	"goals" text[] DEFAULT '{}'::text[] NOT NULL,
	"bio" text,
	"auto_post_medals" boolean DEFAULT false NOT NULL,
	"auto_post_prs" boolean DEFAULT false NOT NULL,
	"share_injuries_for_matching" boolean DEFAULT false NOT NULL,
	"embedding" vector(384),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"pseudonym" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_handle_unique" UNIQUE("handle"),
	CONSTRAINT "users_pseudonym_unique" UNIQUE("pseudonym")
);
--> statement-breakpoint
CREATE TABLE "form_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rep_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"start_ms" integer,
	"end_ms" integer,
	"tempo_ms" integer NOT NULL,
	"range_deg" real NOT NULL,
	"quality" real,
	"clean" boolean NOT NULL,
	CONSTRAINT "reps_set_position_uq" UNIQUE("set_id","position")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"device" text,
	"inference_mode" "inference_mode" DEFAULT 'on_device' NOT NULL,
	"medal" "medal_tier",
	"form_score" real,
	"export_status" "export_status" DEFAULT 'pending' NOT NULL,
	"export_error" text,
	"exported_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"exercise_id" text NOT NULL,
	"reps" integer NOT NULL,
	"weight_kg" real,
	"medal" "medal_tier",
	"clean_share" real,
	"score_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sets_session_position_uq" UNIQUE("session_id","position")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"muscles" text[] DEFAULT '{}'::text[] NOT NULL,
	"level" "experience_level" DEFAULT 'beginner' NOT NULL,
	"form_spec" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"exercise_id" text NOT NULL,
	"day" integer NOT NULL,
	"position" integer NOT NULL,
	"sets" integer NOT NULL,
	"reps" integer NOT NULL,
	"swap_note" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"week_of" date NOT NULL,
	"ai_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE "buddy_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"a_id" text NOT NULL,
	"b_id" text NOT NULL,
	"score" real NOT NULL,
	"status" "buddy_status" DEFAULT 'requested' NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buddy_matches_not_self" CHECK ("buddy_matches"."a_id" <> "buddy_matches"."b_id")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"ai_suggested" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" text NOT NULL,
	"followee_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "follows_not_self" CHECK ("follows"."follower_id" <> "follows"."followee_id")
);
--> statement-breakpoint
CREATE TABLE "kudos" (
	"post_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kudos_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" text NOT NULL,
	"kind" "post_kind" NOT NULL,
	"body" text NOT NULL,
	"session_id" uuid,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"description" text NOT NULL,
	"metric" text,
	"target_value" integer,
	"target_date" date,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"tier" "medal_tier" NOT NULL,
	"form_score" real NOT NULL,
	"baseline_share" real NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medals_sessionId_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "personal_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"metric" "pr_metric" NOT NULL,
	"value" real NOT NULL,
	"previous_value" real,
	"session_id" uuid,
	"achieved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"body_part" text NOT NULL,
	"score" real NOT NULL,
	"explanation" text,
	"top_features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"as_of" date NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_insights_upsert_key" UNIQUE("user_id","body_part","as_of")
);
--> statement-breakpoint
CREATE TABLE "doc_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(384) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "injuries" ADD CONSTRAINT "injuries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_flags" ADD CONSTRAINT "form_flags_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reps" ADD CONSTRAINT "reps_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_matches" ADD CONSTRAINT "buddy_matches_a_id_users_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_matches" ADD CONSTRAINT "buddy_matches_b_id_users_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medals" ADD CONSTRAINT "medals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medals" ADD CONSTRAINT "medals_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_insights" ADD CONSTRAINT "risk_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "injuries_user_idx" ON "injuries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "profiles_gym_idx" ON "profiles" USING btree ("gym_place_id");--> statement-breakpoint
CREATE INDEX "profiles_embedding_idx" ON "profiles" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "form_flags_rep_idx" ON "form_flags" USING btree ("rep_id");--> statement-breakpoint
CREATE INDEX "sessions_user_started_idx" ON "sessions" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sets_exercise_idx" ON "sets" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "plan_items_plan_idx" ON "plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plans_user_week_idx" ON "plans" USING btree ("user_id","week_of" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_matches_pair_uq" ON "buddy_matches" USING btree (least("a_id", "b_id"),greatest("a_id", "b_id"));--> statement-breakpoint
CREATE INDEX "buddy_matches_b_idx" ON "buddy_matches" USING btree ("b_id");--> statement-breakpoint
CREATE INDEX "comments_post_created_idx" ON "comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "follows_followee_idx" ON "follows" USING btree ("followee_id");--> statement-breakpoint
CREATE INDEX "posts_created_idx" ON "posts" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_author_created_idx" ON "posts" USING btree ("author_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "medals_user_awarded_idx" ON "medals" USING btree ("user_id","awarded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "personal_records_lookup_idx" ON "personal_records" USING btree ("user_id","exercise_id","metric","value" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "doc_chunks_source_idx" ON "doc_chunks" USING btree ("source");--> statement-breakpoint
CREATE INDEX "doc_chunks_embedding_idx" ON "doc_chunks" USING hnsw ("embedding" vector_cosine_ops);