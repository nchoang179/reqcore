CREATE TABLE "feed_fetch" (
	"id" text PRIMARY KEY NOT NULL,
	"board" text,
	"job_count" integer NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"duration_ms" integer,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "last_included_in_feed_at" timestamp;--> statement-breakpoint
CREATE INDEX "feed_fetch_board_fetched_at_idx" ON "feed_fetch" USING btree ("board","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feed_fetch_fetched_at_idx" ON "feed_fetch" USING btree ("fetched_at" DESC NULLS LAST);