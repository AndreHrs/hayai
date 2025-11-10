import { Context, Next } from "hono";
import { verifyJWT } from "../utils";
import { fail } from "../core/response";

export interface AuthContext extends Context {
  userId?: string;
  userEmail?: string;
  userRole?: string;
}

export async function authMiddleware(c: AuthContext, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const [response, responseStatus] = fail("Unauthorized - No token provided", 401);
    c.status(responseStatus);
    return c.json(response);
  }

  const token = authHeader.substring(7);

  try {
    const payload = await verifyJWT(token);
    c.userId = payload.userId;
    c.userEmail = payload.email;
    c.userRole = payload.role;
    await next();
  } catch (error) {
    const [response, responseStatus] = fail("Unauthorized - Invalid token", 401);
    c.status(responseStatus);
    return c.json(response);
  }
}
