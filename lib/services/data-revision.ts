/**
 * A single value that changes whenever shared data changes.
 *
 * The point of this is what it *avoids*. Broadcasting the rows themselves would
 * mean merge logic on the client, ordering guarantees between the broadcast and
 * the reply to your own PATCH, and a whole class of "my optimistic edit got
 * overwritten by a stale frame" bugs. A revision says only "something moved" —
 * the client then re-reads through the same path it used originally, so there is
 * exactly one way data reaches a screen and it is already the tested one.
 *
 * `MAX(updated_at)` alone would miss a delete, since deleting a row lowers
 * nothing and touches nothing. Pairing it with `COUNT(*)` catches inserts and
 * deletes; together they catch everything short of a delete and an insert
 * landing inside the same clock tick with identical timestamps, which cannot
 * happen here because `updated_at` moves on every write.
 */

import { prisma } from "@/lib/db/prisma";

export interface DataRevision {
  events: string;
  stages: string;
  notes: string;
}

/** Serialised for comparison and for sending down the wire. */
export function revisionToken(revision: DataRevision): string {
  return `${revision.events}~${revision.stages}~${revision.notes}`;
}

/** Uncached. Exported so tests can observe a change without racing the cache. */
export async function computeRevision(): Promise<DataRevision> {
  const [events, stages, notes] = await Promise.all([
    prisma.event.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.reviewStage.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    // Notes have no updatedAt; `editedAt` is set on edit and createdAt on
    // insert, so the pair covers both without a schema change.
    prisma.eventNote.aggregate({
      _count: { _all: true },
      _max: { createdAt: true, editedAt: true },
    }),
  ]);

  const stamp = (date: Date | null | undefined) => date?.getTime() ?? 0;

  return {
    events: `${events._count._all}:${stamp(events._max.updatedAt)}`,
    stages: `${stages._count._all}:${stamp(stages._max.updatedAt)}`,
    notes: `${notes._count._all}:${Math.max(
      stamp(notes._max.createdAt),
      stamp(notes._max.editedAt),
    )}`,
  };
}

/**
 * Cached briefly, because every open stream would otherwise run these
 * aggregates on its own timer.
 *
 * Each connected browser holds a stream polling every couple of seconds; with a
 * cache the whole team costs one set of aggregates per window rather than one
 * per person. The TTL is deliberately shorter than the poll interval, so it
 * collapses concurrent callers without ever adding a poll's worth of latency.
 */
const CACHE_TTL_MS = 1_000;

let cached: { token: string; at: number } | null = null;
let inFlight: Promise<string> | null = null;

export async function getRevisionToken(): Promise<string> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.token;
  if (inFlight) return inFlight;

  inFlight = computeRevision()
    .then((revision) => {
      const token = revisionToken(revision);
      cached = { token, at: Date.now() };
      return token;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
