import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config/env";
//SECTION::IMPORT_ROUTES
import userRoutes from "./routes/userRoutes";

const app = new Hono();

// CORS middleware
app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// Health check
app.get("/", (c) => {
  return c.json({
    message: "Hayai Base API",
    version: "1.0.0",
    endpoints: {
      auth: {
        signup: "POST /api/auth/signup",
        login: "POST /api/auth/login",
      },
    },
  });
});

// SECTION::API_ROUTES
app.route("/api/auth", userRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error(`${err}`);
  return c.json({ error: "Internal server error" }, 500);
});

// Export app for testing
export { app };

export default {
  port: config.port,
  fetch: app.fetch,
};
