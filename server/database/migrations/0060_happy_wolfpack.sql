CREATE TYPE "public"."ai_usage_feature" AS ENUM('chatbot_message');--> statement-breakpoint
CREATE TABLE "ai_usage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"feature" "ai_usage_feature" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_usd_micros" integer,
	"billing_mode" "analysis_billing_mode" DEFAULT 'byok' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chatbot_conversation" ADD COLUMN "use_platform_ai" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_ai_config" ADD COLUMN "is_default_chatbot" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ai_usage_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ai_usage_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_event_org_billing_created_idx" ON "ai_usage_event" USING btree ("organization_id","billing_mode","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_event_billing_created_idx" ON "ai_usage_event" USING btree ("billing_mode","created_at");