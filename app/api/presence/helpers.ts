import { presenceActionSchema } from "@/lib/validation/schemas";
import { validationError } from "@/lib/errors";

export { presenceActionSchema };

/** START and STOP need an event; HEARTBEAT and CLEAR do not. */
export function validationErrorIfMissingEvent(eventId: string | undefined): string {
  if (!eventId) {
    throw validationError("An event id is required for this action.");
  }
  return eventId;
}
