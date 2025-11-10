import type { StatusCode } from "hono/utils/http-status";

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

/**
 * Creates a success response
 */
export function success<T>(
  data: T,
  message?: string,
  status: StatusCode = 200,
): [ApiResponse<T>, StatusCode] {
  const response: ApiResponse<T> = {
    success: true,
    ...(message && { message }),
    ...(data !== undefined && { data }),
  };
  return [response, status];
}

/**
 * Creates a failure response
 */
export function fail(
  message?: string,
  status: StatusCode = 500,
  data?: any,
): [ApiResponse<any>, StatusCode] {
  const response: ApiResponse<any> = {
    success: false,
    ...(message && { message }),
    ...(data !== undefined && { data }),
  };
  return [response, status];
}

/**
 * Creates a validation error response
 */
export function validationError(
  details: Record<string, string[]>,
  message = "Validation failed",
): [ApiResponse<any>, StatusCode] {
  const response: ApiResponse<any> = {
    success: false,
    message,
    data: {
      VALIDATION: details,
    },
  };
  return [response, 400];
}
