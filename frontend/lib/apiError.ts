import axios from "axios";

/** A failed API call, normalised from FastAPI's `{detail: string}` or 422 `{detail: [{loc, msg}]}` bodies. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function toApiRequestError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  if (!axios.isAxiosError(error)) {
    return new ApiRequestError(error instanceof Error ? error.message : "Something went wrong.", undefined);
  }
  if (!error.response) return new ApiRequestError("Can't reach the server. Is the stack running?", undefined);

  const { status, data } = error.response;
  const detail = (data as { detail?: unknown } | undefined)?.detail;
  if (typeof detail === "string") return new ApiRequestError(detail, status);
  if (Array.isArray(detail)) {
    const fieldErrors: Record<string, string> = {};
    for (const item of detail as { loc?: unknown[]; msg?: string }[]) {
      const field = item.loc?.at(-1);
      if (typeof field === "string" && item.msg && !fieldErrors[field]) {
        fieldErrors[field] = item.msg.replace(/^Value error, /, "");
      }
    }
    return new ApiRequestError("Please fix the highlighted fields.", status, fieldErrors);
  }
  return new ApiRequestError(`Request failed (${status}).`, status);
}

export async function withApiErrors<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    throw toApiRequestError(error);
  }
}
