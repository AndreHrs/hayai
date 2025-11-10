import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { Context } from "hono";
import { validationError } from "./response";

export function validateSchema<T extends z.ZodTypeAny>(schema: T) {
  return zValidator("json", schema, (result, c: Context) => {
    if (!result.success) {
      const issues = result.error.issues;
      const fieldErrors: Record<string, string[]> = {};

      // Group errors by field path
      for (const error of issues) {
        const path = error.path.length > 0 ? error.path.join(".") : "root";
        if (!fieldErrors[path]) {
          fieldErrors[path] = [];
        }

        // Extract validation message
        // Custom messages from schema (like "TOO_SHORT", "MUST_CONTAIN_NUMBER")
        // are already in error.message
        let message = error.message;

        // Map Zod 4.x error codes to standardized validation codes
        if (error.code === "invalid_type") {
          // Check if it's a missing/undefined field
          if (
            error.message.includes("undefined") ||
            error.message.includes("null")
          ) {
            message = "REQUIRED";
          } else {
            message = "INVALID_TYPE";
          }
        } else if (error.code === "too_small") {
          // Check if custom message exists, otherwise use TOO_SMALL
          if (
            !error.message ||
            error.message.includes("At least") ||
            error.message.includes("minimum")
          ) {
            message = "TOO_SMALL";
          }
        } else if (error.code === "too_big") {
          message = "TOO_BIG";
        } else if (error.code === "invalid_format") {
          // Zod 4.x uses invalid_format for email, url, etc.
          if (error.format === "email") {
            message = "INVALID_EMAIL";
          } else {
            message = "INVALID_FORMAT";
          }
        } else if (error.code === "custom") {
          // Custom messages are already set correctly
          message = error.message;
        } else if (!error.message || error.message.includes("Required")) {
          message = "REQUIRED";
        }

        // Normalize message to uppercase with underscores
        message = message.toUpperCase().replace(/\s+/g, "_");

        // Avoid duplicates
        if (!fieldErrors[path].includes(message)) {
          fieldErrors[path].push(message);
        }
      }

      const [body, status] = validationError(fieldErrors);
      return c.json(body, status as 400);
    }
  });
}
