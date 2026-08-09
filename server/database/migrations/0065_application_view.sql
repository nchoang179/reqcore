CREATE TABLE "application_view" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"application_id" text NOT NULL,
	"user_id" text NOT NULL,
	"viewed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_view" ADD CONSTRAINT "application_view_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_view" ADD CONSTRAINT "application_view_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_view" ADD CONSTRAINT "application_view_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_view_application_user_idx" ON "application_view" USING btree ("application_id","user_id");--> statement-breakpoint
CREATE INDEX "application_view_org_user_idx" ON "application_view" USING btree ("organization_id","user_id");--> statement-breakpoint
-- Backfill: everything that existed before read receipts starts as viewed.
-- Without this, every org's first load after deploy would flag its entire
-- back catalogue as "not viewed yet" — exactly the meaningless badge this
-- feature replaces. Receipts are per user, so one row per existing member.
INSERT INTO "application_view" ("id", "organization_id", "application_id", "user_id", "viewed_at", "created_at")
-- md5 of the pair, so re-running the backfill can't duplicate rows.
SELECT md5(a."id" || ':' || m."user_id"), a."organization_id", a."id", m."user_id", now(), now()
FROM "application" a
JOIN "member" m ON m."organization_id" = a."organization_id"
ON CONFLICT DO NOTHING;