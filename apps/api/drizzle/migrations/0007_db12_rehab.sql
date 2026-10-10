CREATE TYPE "public"."injury_side" AS ENUM('left', 'right', 'both', 'n/a');--> statement-breakpoint
CREATE TYPE "public"."limb_side" AS ENUM('left', 'right', 'both');--> statement-breakpoint
CREATE TYPE "public"."rehab_plan_status" AS ENUM('active', 'paused', 'done');--> statement-breakpoint
CREATE TABLE "rehab_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rehab_plan_id" uuid NOT NULL,
	"exercise_id" text NOT NULL,
	"angle" text NOT NULL,
	"side" "limb_side" DEFAULT 'both' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"max_range_deg" real NOT NULL,
	"sets" integer NOT NULL,
	"reps" integer NOT NULL,
	"tempo_min_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rehab_limits_plan_exercise_angle_side_uq" UNIQUE("rehab_plan_id","exercise_id","angle","side"),
	CONSTRAINT "rehab_limits_range" CHECK ("rehab_limits"."max_range_deg" >= 0 and "rehab_limits"."max_range_deg" <= 180),
	CONSTRAINT "rehab_limits_volume" CHECK ("rehab_limits"."sets" > 0 and "rehab_limits"."reps" > 0),
	CONSTRAINT "rehab_limits_tempo" CHECK ("rehab_limits"."tempo_min_ms" is null or "rehab_limits"."tempo_min_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "rehab_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"injury_id" uuid,
	"from_physio" text,
	"start_on" date NOT NULL,
	"review_on" date,
	"status" "rehab_plan_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rehab_plans_review_after_start" CHECK ("rehab_plans"."review_on" is null or "rehab_plans"."review_on" >= "rehab_plans"."start_on")
);
--> statement-breakpoint
ALTER TABLE "injuries" ADD COLUMN "side" "injury_side" DEFAULT 'n/a' NOT NULL;--> statement-breakpoint
ALTER TABLE "rehab_limits" ADD CONSTRAINT "rehab_limits_rehab_plan_id_rehab_plans_id_fk" FOREIGN KEY ("rehab_plan_id") REFERENCES "public"."rehab_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_limits" ADD CONSTRAINT "rehab_limits_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_plans" ADD CONSTRAINT "rehab_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rehab_plans" ADD CONSTRAINT "rehab_plans_injury_id_injuries_id_fk" FOREIGN KEY ("injury_id") REFERENCES "public"."injuries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rehab_limits_plan_idx" ON "rehab_limits" USING btree ("rehab_plan_id","position");--> statement-breakpoint
CREATE INDEX "rehab_plans_user_idx" ON "rehab_plans" USING btree ("user_id","start_on" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "rehab_plans_one_active_uq" ON "rehab_plans" USING btree ("user_id") WHERE "rehab_plans"."status" = 'active';