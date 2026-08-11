-- Data-integrity constraints that Prisma's schema language cannot express.
--
-- These are not decorative. The completion-coherence checks below previously
-- caught a real ordering bug where a completion timestamp was cleared while its
-- attribution was left behind, which would otherwise have written misleading
-- rows silently. Keep them when regenerating migrations.

-- Settings is a single row.
ALTER TABLE "settings"
    ADD CONSTRAINT "settings_singleton_check"
    CHECK ("id" = 'singleton');

-- Review stage offsets must be positive and within a sane horizon. The exact
-- set is administrator-configurable, so this is a sanity bound, not a whitelist.
ALTER TABLE "review_stages"
    ADD CONSTRAINT "review_stages_offset_range_check"
    CHECK ("offset_days" > 0 AND "offset_days" <= 365);

-- A stage is DONE exactly when it has a completion instant.
ALTER TABLE "review_stages"
    ADD CONSTRAINT "review_stages_done_coherent_check"
    CHECK (
        ("status" = 'DONE' AND "done_at" IS NOT NULL)
        OR ("status" <> 'DONE' AND "done_at" IS NULL)
    );

-- Attribution without a completion instant is meaningless.
ALTER TABLE "review_stages"
    ADD CONSTRAINT "review_stages_done_by_check"
    CHECK ("done_by_id" IS NULL OR "done_at" IS NOT NULL);

ALTER TABLE "events"
    ADD CONSTRAINT "events_completed_by_check"
    CHECK ("completed_by_id" IS NULL OR "completed_at" IS NOT NULL);

ALTER TABLE "events"
    ADD CONSTRAINT "events_seatgeek_by_check"
    CHECK ("seatgeek_by_id" IS NULL OR "seatgeek_checked_at" IS NOT NULL);

-- An event may only be in C1 (or beyond) if it was actually completed on the
-- dashboard, which is the sole promotion path.
ALTER TABLE "events"
    ADD CONSTRAINT "events_c1_requires_completion_check"
    CHECK ("status" NOT IN ('C1', 'COMPLETED') OR "completed_at" IS NOT NULL);

-- Emails are matched case-insensitively at sign-in; store them normalised.
ALTER TABLE "users"
    ADD CONSTRAINT "users_email_lowercase_check"
    CHECK ("email" = lower("email"));

-- User colours are lowercase #rrggbb, so the UI can use them verbatim.
ALTER TABLE "users"
    ADD CONSTRAINT "users_color_format_check"
    CHECK ("color" ~ '^#[0-9a-f]{6}$');

-- A note with no text is noise.
ALTER TABLE "event_notes"
    ADD CONSTRAINT "event_notes_body_not_blank_check"
    CHECK (length(btrim("body")) > 0);
