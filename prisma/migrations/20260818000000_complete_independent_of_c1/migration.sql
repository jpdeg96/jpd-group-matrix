-- Complete and C1 membership become independent.
--
-- The constraint asserted that anything in C1 carries a completion, which was
-- true while ticking Complete was what put it there. It is not true any more:
-- promotion is a separate, deliberate act, and unticking Complete must leave an
-- event's C1 status and its review stages exactly as they are.
--
-- The reason is the correction case. An event can be ticked, sent for review,
-- and then need a detail changed — which is precisely what "stale" exists to
-- surface. Under the old rule, unticking to make that correction either failed
-- or destroyed the review work already done on it. Neither is acceptable, and
-- both came from a constraint tying two things that had stopped being one.
--
-- What still holds, in the service rather than here: an event cannot be *sent*
-- to C1 without a completion. That is a precondition on the act of sending, not
-- an invariant on the row, and expressing it as a row invariant is what caused
-- this. `sendToC1` enforces it.

ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_c1_requires_completion_check";
