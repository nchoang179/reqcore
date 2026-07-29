ALTER TYPE "public"."source_channel" ADD VALUE 'jooble';--> statement-breakpoint
ALTER TYPE "public"."source_channel" ADD VALUE 'adzuna';--> statement-breakpoint
ALTER TYPE "public"."source_channel" ADD VALUE 'careerjet';--> statement-breakpoint
ALTER TYPE "public"."source_channel" ADD VALUE 'talent_com';--> statement-breakpoint
ALTER TYPE "public"."source_channel" ADD VALUE 'jobsora';--> statement-breakpoint
ALTER TYPE "public"."source_channel" ADD VALUE 'jora';--> statement-breakpoint
ALTER TYPE "public"."source_channel" ADD VALUE 'whatjobs';--> statement-breakpoint
ALTER TYPE "public"."source_channel" ADD VALUE 'whatsapp';--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "location_city" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "location_region" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "location_country" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "distribute_to_boards" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "company_description" text;--> statement-breakpoint
-- Backfill: jobs that are already public predate `published_at`. Without this
-- every existing role would enter the job board feed dated NULL and fall back to
-- `created_at` inconsistently. Seed from `created_at`, the best available proxy.
UPDATE "job" SET "published_at" = "created_at" WHERE "status" = 'open' AND "published_at" IS NULL;