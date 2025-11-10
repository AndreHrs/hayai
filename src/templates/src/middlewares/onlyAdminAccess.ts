import type { Next } from "hono";
import type { AuthContext } from "./auth";
import { fail } from "../core/response";
import { prisma } from "../db";
import { getCachedRole, setCachedRole } from "../utils/userRoleCache";

export async function onlyAdminAccess(
  c: AuthContext,
  next: Next,
): Promise<Response | void> {
  if (!c.userId) {
    const [response, responseStatus] = fail("Unauthorized", 401);
    c.status(responseStatus);
    return c.json(response);
  }

  // Check cache first
  let userRole = getCachedRole(c.userId);

  // If not in cache or expired, fetch from database
  if (!userRole) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: c.userId },
        select: { role: true },
      });

      if (!user) {
        const [response, responseStatus] = fail("User not found", 404);
        c.status(responseStatus);
        return c.json(response);
      }

      if (!user.role) {
        const [response, responseStatus] = fail("User role not found", 404);
        c.status(responseStatus);
        return c.json(response);
      }

      // TypeScript doesn't narrow Prisma types, so we assert it's a string
      const role: string = user.role;
      userRole = role;
      // Cache the role
      setCachedRole(c.userId, role);
    } catch (error) {
      const [response, responseStatus] = fail("Failed to verify user role", 500);
      c.status(responseStatus);
      return c.json(response);
    }
  }

  // Check if user is admin
  if (userRole !== "ADMIN") {
    const [response, responseStatus] = fail("Admin access required", 403);
    c.status(responseStatus);
    return c.json(response);
  }

  await next();
}
