import { Context } from "hono";
import { success, fail, validationError, type ApiResponse } from "./response";
import { AuthContext } from "../middlewares/auth";
import { StatusCode } from "hono/utils/http-status";

export abstract class BaseController {
  /**
   * Safely get validated JSON from request
   * Use this to access validated data after validateSchema middleware
   */
  protected getValidJson<T>(c: Context): T {
    // @ts-expect-error - Hono type inference doesn't work with custom validator wrapper
    return c.req.valid("json" as any) as T;
  }

  /**
   * Execute an action with error handling and standardized response
   */
  protected async execute<T>(
    c: Context,
    action: () => Promise<T>,
    message?: string,
    status: StatusCode = 200
  ): Promise<Response> {
    try {
      const data = await action();
      const [response, responseStatus] = success(data, message, status);
      c.status(responseStatus);
      return c.json(response);
    } catch (error) {
      console.error("Controller error:", error);
      const [response, responseStatus] = fail("Internal server error", 500);
      c.status(responseStatus);
      return c.json(response);
    }
  }

  /**
   * Return a success response
   */
  protected success<T>(
    c: Context,
    data: T,
    message?: string,
    status: StatusCode = 200
  ): Response {
    const [response, responseStatus] = success(data, message, status);
    c.status(responseStatus);
    return c.json(response);
  }

  /**
   * Return a failure response
   */
  protected fail(
    c: Context,
    message?: string,
    status: StatusCode = 500,
    data?: any
  ): Response {
    const [response, responseStatus] = fail(message, status, data);
    c.status(responseStatus);
    return c.json(response);
  }

  /**
   * Return an unauthorized (401) response
   * Use this as a scaffold for custom 401 responses
   *
   * @example
   * return this.unauthorized(c, "Invalid credentials");
   * return this.unauthorized(c, "Token expired");
   */
  protected unauthorized(c: Context, message = "Unauthorized"): Response {
    return this.fail(c, message, 401);
  }

  /**
   * Return a forbidden (403) response
   * Use this as a scaffold for custom 403 responses
   *
   * @example
   * return this.forbidden(c, "Insufficient permissions");
   * return this.forbidden(c, "Resource access denied");
   */
  protected forbidden(
    c: Context,
    message = "Forbidden - Access denied"
  ): Response {
    return this.fail(c, message, 403);
  }

  /**
   * Ensure the current user owns the resource
   * Returns null if ownership is valid, or a 403 Response if not
   */
  protected ensureOwnership(
    c: AuthContext,
    resourceOwnerId: string,
    message?: string
  ): Response | null {
    if (!c.userId) {
      return this.unauthorized(c);
    }

    if (c.userId !== resourceOwnerId) {
      return this.forbidden(
        c,
        message ||
          "Forbidden - You do not have permission to access this resource"
      );
    }

    return null;
  }

  /**
   * Return a validation error response
   */
  protected validationFail(
    c: Context,
    details: Record<string, string[]>,
    message?: string
  ): Response {
    const [response, responseStatus] = validationError(details, message);
    c.status(responseStatus);
    return c.json(response);
  }
}
