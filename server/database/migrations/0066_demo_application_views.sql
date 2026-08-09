-- Read receipts are not recorded for the demo org (see recordApplicationView),
-- but 0065's backfill ran before that rule existed and marked the demo's whole
-- back catalogue as viewed — leaving the demo with no unviewed markers at all.
--
-- Clear those rows so the demo shows the feature. Nothing writes them back:
-- the demo is a single shared account, so a stored receipt would mark a
-- candidate read for every later visitor. The client-side composable still
-- hides a marker for the rest of the visitor's own session.
--
-- Written as a separate migration rather than an edit to 0065 because 0065 has
-- already been applied in preview environments; changing it would alter its
-- hash and make drizzle re-run it.
DELETE FROM "application_view"
WHERE "organization_id" IN (
  SELECT "id" FROM "organization" WHERE "slug" = 'reqcore-demo'
);
