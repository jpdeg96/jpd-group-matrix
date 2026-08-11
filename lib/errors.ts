/**
 * Application error taxonomy.
 *
 * Services throw these; the API layer maps them to status codes and
 * user-facing messages. Nothing fails silently — an operation either succeeds
 * or raises something with a message an operator can act on.
 */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INTERNAL";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Field-level messages, keyed by form field name. */
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    code: AppErrorCode,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fieldErrors = fieldErrors;
  }
}

export const unauthenticated = (message = "You must be signed in.") =>
  new AppError("UNAUTHENTICATED", message);

export const forbidden = (message = "You do not have permission to do that.") =>
  new AppError("FORBIDDEN", message);

export const notFound = (message = "Not found.") => new AppError("NOT_FOUND", message);

export const validationError = (
  message: string,
  fieldErrors?: Record<string, string[]>,
) => new AppError("VALIDATION", message, fieldErrors);

export const conflict = (message: string) => new AppError("CONFLICT", message);

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Prisma unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Prisma foreign-key violation — e.g. assigning a user id that does not exist. */
export function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2003"
  );
}
