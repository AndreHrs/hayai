import { detectFromUrl } from "../utils/dbUrlUtils";

/**
 * Detect database provider from URL or DATABASE_TYPE env var
 */
export function getDatabaseProvider(): "sqlite" | "postgresql" | "mysql" {
  // Check DATABASE_TYPE env var first (e.g., "POSTGRE", "MYSQL", "SQLITE")
  const dbType = process.env.DATABASE_TYPE?.toUpperCase();
  if (dbType === "POSTGRE" || dbType === "POSTGRESQL") {
    return "postgresql";
  }
  if (dbType === "MYSQL") {
    return "mysql";
  }
  if (dbType === "SQLITE") {
    return "sqlite";
  }

  // Fallback: detect from DATABASE_URL format
  const dbUrl = process.env.DATABASE_URL || "";
  return detectFromUrl(dbUrl);
}

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  // JWT
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiration: process.env.JWT_EXPIRATION || "7d",

  // Password
  saltRounds: parseInt(process.env.SALT_ROUNDS || "10", 10),

  // Database
  // Use getters for lazy evaluation (computed when accessed, not at module load)
  get databaseProvider() {
    return getDatabaseProvider();
  },
  // Use separate test database when NODE_ENV=test
  get databaseUrl() {
    return process.env.NODE_ENV === "test"
      ? process.env.TEST_DATABASE_URL
      : process.env.DATABASE_URL || "file:./dev.db";
  },
};

// Validate required environment variables
if (!config.jwtSecret) {
  throw new Error("JWT_SECRET environment variable is required");
}
