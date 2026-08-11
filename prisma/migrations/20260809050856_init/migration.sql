-- CreateEnum
CREATE TYPE "public"."user_role" AS ENUM ('ADMIN', 'MANAGER', 'USER');

-- CreateEnum
CREATE TYPE "public"."event_status" AS ENUM ('DASHBOARD', 'C1', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."stage_status" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "public"."presence_context" AS ENUM ('DASHBOARD', 'C1');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" "public"."user_role" NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."event_types" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."events" (
    "id" UUID NOT NULL,
    "event_date" DATE NOT NULL,
    "event_type_id" UUID NOT NULL,
    "away_team" TEXT,
    "home_team" TEXT,
    "venue" TEXT,
    "status" "public"."event_status" NOT NULL DEFAULT 'DASHBOARD',
    "assignee_id" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "completed_by_id" UUID,
    "seatgeek_checked_at" TIMESTAMPTZ(6),
    "seatgeek_by_id" UUID,
    "ticketdata_checked" BOOLEAN NOT NULL DEFAULT false,
    "ticketdata_by_id" UUID,
    "promoted_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."review_stages" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "offset_days" SMALLINT NOT NULL,
    "review_due" DATE NOT NULL,
    "review_due_overridden" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."stage_status" NOT NULL DEFAULT 'PENDING',
    "assignee_id" UUID,
    "done_at" TIMESTAMPTZ(6),
    "done_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."event_notes" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "edited_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."presence" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "context" "public"."presence_context" NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_heartbeat" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "site_name" TEXT NOT NULL DEFAULT 'JPD Group Matrix',
    "time_zone" TEXT NOT NULL DEFAULT 'America/Caracas',
    "review_offsets" INTEGER[] DEFAULT ARRAY[21, 14, 7, 5, 1]::INTEGER[],
    "weekend_adjustment" BOOLEAN NOT NULL DEFAULT true,
    "presence_timeout_minutes" INTEGER NOT NULL DEFAULT 5,
    "default_theme" TEXT NOT NULL DEFAULT 'light',
    "seatgeek_links_enabled" BOOLEAN NOT NULL DEFAULT true,
    "stubhub_links_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "impersonated_user_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_active_display_name_idx" ON "public"."users"("active", "display_name");

-- CreateIndex
CREATE UNIQUE INDEX "event_types_name_key" ON "public"."event_types"("name");

-- CreateIndex
CREATE INDEX "event_types_active_sort_order_name_idx" ON "public"."event_types"("active", "sort_order", "name");

-- CreateIndex
CREATE INDEX "events_status_event_date_idx" ON "public"."events"("status", "event_date");

-- CreateIndex
CREATE INDEX "events_event_date_idx" ON "public"."events"("event_date");

-- CreateIndex
CREATE INDEX "events_assignee_idx" ON "public"."events"("assignee_id");

-- CreateIndex
CREATE INDEX "events_event_type_idx" ON "public"."events"("event_type_id");

-- CreateIndex
CREATE INDEX "review_stages_status_due_idx" ON "public"."review_stages"("status", "review_due");

-- CreateIndex
CREATE INDEX "review_stages_event_idx" ON "public"."review_stages"("event_id");

-- CreateIndex
CREATE INDEX "review_stages_assignee_idx" ON "public"."review_stages"("assignee_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_stages_event_offset_key" ON "public"."review_stages"("event_id", "offset_days");

-- CreateIndex
CREATE INDEX "event_notes_event_idx" ON "public"."event_notes"("event_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "presence_heartbeat_idx" ON "public"."presence"("last_heartbeat");

-- CreateIndex
CREATE INDEX "presence_event_idx" ON "public"."presence"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "presence_user_event_context_key" ON "public"."presence"("user_id", "event_id", "context");

-- CreateIndex
CREATE INDEX "audit_logs_entity_idx" ON "public"."audit_logs"("entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "public"."audit_logs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "public"."events" ADD CONSTRAINT "events_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."events" ADD CONSTRAINT "events_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."events" ADD CONSTRAINT "events_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."events" ADD CONSTRAINT "events_seatgeek_by_id_fkey" FOREIGN KEY ("seatgeek_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."events" ADD CONSTRAINT "events_ticketdata_by_id_fkey" FOREIGN KEY ("ticketdata_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_stages" ADD CONSTRAINT "review_stages_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_stages" ADD CONSTRAINT "review_stages_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_stages" ADD CONSTRAINT "review_stages_done_by_id_fkey" FOREIGN KEY ("done_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_notes" ADD CONSTRAINT "event_notes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_notes" ADD CONSTRAINT "event_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."presence" ADD CONSTRAINT "presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."presence" ADD CONSTRAINT "presence_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
