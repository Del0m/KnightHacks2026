CREATE TYPE "public"."exercise_rating" AS ENUM('like', 'dislike');--> statement-breakpoint
CREATE TYPE "public"."plan_source" AS ENUM('llm', 'rules');--> statement-breakpoint
CREATE TABLE "exercise_preferences" (
	"user_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"rating" "exercise_rating" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_preferences_user_id_exercise_id_pk" PRIMARY KEY("user_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "exercise_taste" (
	"user_id" text PRIMARY KEY NOT NULL,
	"embedding" vector(384) NOT NULL,
	"exercises" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_items" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "plan_items" ADD COLUMN "safety_note" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "source" "plan_source" DEFAULT 'rules' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "notes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "history" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "exercise_preferences" ADD CONSTRAINT "exercise_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_preferences" ADD CONSTRAINT "exercise_preferences_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_taste" ADD CONSTRAINT "exercise_taste_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;