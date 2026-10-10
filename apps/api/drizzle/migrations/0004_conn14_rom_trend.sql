CREATE TABLE "rom_trend" (
	"user_id" text NOT NULL,
	"angle" text NOT NULL,
	"side" text NOT NULL,
	"week" date NOT NULL,
	"peak_range_deg" real NOT NULL,
	"baseline_range_deg" real,
	"healthy_side_range_deg" real,
	"change_deg" real,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rom_trend_user_id_angle_side_week_pk" PRIMARY KEY("user_id","angle","side","week")
);
--> statement-breakpoint
ALTER TABLE "rom_trend" ADD CONSTRAINT "rom_trend_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;