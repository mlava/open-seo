import { isErrorCode, type ErrorCode } from "@/shared/error-codes";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: Record<string, string>,
  ) {
    super(message ?? code);
    this.name = "AppError";
  }
}

export function asAppError(error: unknown): AppError | null {
  if (error instanceof AppError) return error;
  if (error instanceof Error && isErrorCode(error.message)) {
    return new AppError(error.message, error.message);
  }
  return null;
}

// Codes whose server-side message is safe and useful to show the user.
// Setup errors: static guidance ("TEAM_DOMAIN must be a full https URL…")
// that self-hosters need to fix their deployment. Validation errors: they
// describe the user's own rejected input ("AI performance CSV is missing
// column(s): …"), and the generic fallback makes every rejected input look
// the same. Everything else stays stripped to its bare code.
const CLIENT_DETAIL_ERROR_CODES = new Set<ErrorCode>([
  "AUTH_CONFIG_MISSING",
  "VALIDATION_ERROR",
]);

export function toClientError(error: unknown): Error {
  const appError = asAppError(error);
  if (
    appError &&
    CLIENT_DETAIL_ERROR_CODES.has(appError.code) &&
    appError.message !== appError.code
  ) {
    return new Error(`${appError.code}: ${appError.message}`);
  }
  return new Error(appError?.code ?? "INTERNAL_ERROR");
}
