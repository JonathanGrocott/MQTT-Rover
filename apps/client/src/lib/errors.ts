export function errorMessage(error: unknown, fallback = "Unknown error"): string {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const withMessage = error as { message?: unknown; payload?: unknown };
    if (typeof withMessage.message === "string" && withMessage.message.trim().length > 0) {
      return withMessage.message;
    }
    if (typeof withMessage.payload === "string" && withMessage.payload.trim().length > 0) {
      return withMessage.payload;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return fallback;
    }
  }

  return fallback;
}
