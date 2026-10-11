ALTER TYPE "public"."inference_mode" RENAME VALUE 'on_device' TO 'coreml';--> statement-breakpoint
ALTER TYPE "public"."inference_mode" ADD VALUE 'vision' BEFORE 'cloud';--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "inference_mode" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "reps" ADD COLUMN "lowering_ms" integer;--> statement-breakpoint
ALTER TABLE "reps" ADD COLUMN "rising_ms" integer;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "end_reason" text;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "partial_reps" integer;
