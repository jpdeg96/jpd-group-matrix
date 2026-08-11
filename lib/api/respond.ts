/**
 * API response helpers.
 *
 * Route handlers stay thin: authorise, parse, call a service, respond. All
 * error-to-status mapping happens here so every endpoint fails the same way.
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, isAppError } from "@/lib/errors";
import { toFieldErrors } from "@/lib/validation/schemas";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
  };
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

/**
 * Converts a thrown value into a response.
 *
 * Known application errors carry a message meant for the user. Anything else is
 * a bug: it is logged in full server-side and reported to the client as a
 * generic failure, so internal details never leak into the UI. Nothing is ever
 * swallowed silently.
 */
export function jsonError(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION",
          message: "Please correct the highlighted fields.",
          fieldErrors: toFieldErrors(error),
        },
      },
      { status: 422 },
    );
  }

  if (isAppError(error)) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        },
      },
      { status: error.status },
    );
  }

  console.error("[api] unhandled error", error);

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Please try again.",
      },
    },
    { status: 500 },
  );
}

/** Wraps a handler so any thrown error becomes a well-formed response. */
export async function handle(
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    return jsonError(error);
  }
}

/** Reads a JSON body, rejecting malformed payloads with a clear message. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION", "Request body must be valid JSON.");
  }
}
