"use client";

/**
 * Browser-side API client.
 *
 * Normalises every failure into an `ApiRequestError` carrying the server's
 * user-facing message, so no call site has to guess at response shapes and no
 * error can be reported to the operator as a bare "failed".
 */

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

async function request<T>(
  url: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...rest.headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    // Network-level failure: there is no response to inspect.
    throw new ApiRequestError(
      0,
      "NETWORK",
      "Could not reach the server. Check your connection and try again.",
    );
  }

  if (response.status === 401) {
    throw new ApiRequestError(
      401,
      "UNAUTHENTICATED",
      "Your session has expired. Please sign in again.",
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> } }
    | null;

  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      body?.error?.code ?? "INTERNAL",
      body?.error?.message ?? "Something went wrong. Please try again.",
      body?.error?.fieldErrors,
    );
  }

  return body as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url, { method: "GET" }),
  post: <T>(url: string, json?: unknown) => request<T>(url, { method: "POST", json }),
  patch: <T>(url: string, json: unknown) => request<T>(url, { method: "PATCH", json }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};

/** Builds a query string, omitting empty values. */
export function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(","));
    } else if (typeof value === "boolean") {
      if (value) search.set(key, "true");
    } else {
      search.set(key, String(value));
    }
  }

  const query = search.toString();
  return query ? `?${query}` : "";
}
