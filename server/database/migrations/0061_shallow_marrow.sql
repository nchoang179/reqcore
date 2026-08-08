CREATE TABLE "chatbot_message_entity_reference" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chatbot_message_entity_reference" ADD CONSTRAINT "chatbot_message_entity_reference_message_id_chatbot_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chatbot_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot_message_entity_reference" ADD CONSTRAINT "chatbot_message_entity_reference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chatbot_message_entity_reference_unique_idx" ON "chatbot_message_entity_reference" USING btree ("message_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "chatbot_message_entity_reference_lookup_idx" ON "chatbot_message_entity_reference" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint

-- Backfill typed references before minimizing legacy tool-call payloads. The
-- source records were already the display-safe projection of each tool result.
INSERT INTO "chatbot_message_entity_reference" (
	"id", "message_id", "organization_id", "entity_type", "entity_id", "created_at"
)
SELECT
	-- Parentheses are required: `||` and `->>` share a precedence level and
	-- associate left-to-right, so an unparenthesised `a || b || v->>'k'` parses
	-- as `((a || b) || v) ->> 'k'` and fails with `operator does not exist: text ->> unknown`.
	md5(message."id" || ':' || (source.value->>'kind') || ':' || (source.value->>'entityId')),
	message."id",
	message."organization_id",
	source.value->>'kind',
	source.value->>'entityId',
	message."created_at"
FROM "chatbot_message" AS message
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(message."sources", '[]'::jsonb)) AS source(value)
WHERE source.value->>'kind' IN ('job', 'candidate', 'application', 'document', 'attachment')
	AND COALESCE(source.value->>'entityId', '') <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Existing rows may contain complete candidate records or resume text in
-- tool_calls[*].output. Preserve only replay-safe tool metadata.
UPDATE "chatbot_message" AS message
SET "tool_calls" = (
	SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
		'id', tool.value->'id',
		'name', tool.value->'name',
		'input', '{}'::jsonb,
		'status', tool.value->'status'
	))) AS value
	FROM jsonb_array_elements(COALESCE(message."tool_calls", '[]'::jsonb)) AS tool(value)
)
WHERE message."tool_calls" IS NOT NULL;--> statement-breakpoint

-- A missing referenced entity indicates that its deletion pre-dated this
-- migration. Remove any surviving conversational copy now.
WITH stale_messages AS (
	SELECT DISTINCT reference."message_id"
	FROM "chatbot_message_entity_reference" AS reference
	WHERE (reference."entity_type" = 'candidate' AND NOT EXISTS (
		SELECT 1 FROM "candidate"
		WHERE "candidate"."id" = reference."entity_id"
			AND "candidate"."organization_id" = reference."organization_id"
	)) OR (reference."entity_type" = 'application' AND NOT EXISTS (
		SELECT 1 FROM "application"
		WHERE "application"."id" = reference."entity_id"
			AND "application"."organization_id" = reference."organization_id"
	)) OR (reference."entity_type" = 'document' AND NOT EXISTS (
		SELECT 1 FROM "document"
		WHERE "document"."id" = reference."entity_id"
			AND "document"."organization_id" = reference."organization_id"
	))
)
UPDATE "chatbot_message"
SET "content" = '[Redacted because this message referenced erased candidate data.]',
	"reasoning" = NULL,
	"tool_calls" = NULL,
	"sources" = NULL,
	"attachments" = NULL
WHERE "id" IN (SELECT "message_id" FROM stale_messages);--> statement-breakpoint

UPDATE "chatbot_conversation" AS conversation
SET "last_message_preview" = NULL,
	"updated_at" = now()
WHERE EXISTS (
	SELECT 1
	FROM "chatbot_message" AS message
	JOIN "chatbot_message_entity_reference" AS reference ON reference."message_id" = message."id"
	WHERE message."conversation_id" = conversation."id"
		AND message."content" = '[Redacted because this message referenced erased candidate data.]'
);
