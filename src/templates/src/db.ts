import { PrismaClient } from "@prisma/client";
import { config } from "./config/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// For test environment, disable query logging and use test database
const isTest = config.nodeEnv === "test";

// Function to get current database URL (allows dynamic updates in tests)
function getDatabaseUrl(): string {
  // In test mode, check if TEST_DATABASE_URL is set (per-file database)
  if (isTest && process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }
  return config.databaseUrl;
}

// Create Prisma client with current database URL
function createPrismaClient(): PrismaClient {
  const dbUrl = getDatabaseUrl();
  return new PrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
    log: isTest
      ? ["error"] // Minimal logging in tests
      : config.nodeEnv === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

// In test mode, create client lazily (on first access) to allow TEST_DATABASE_URL to be set
// In non-test mode, cache for performance
let cachedPrisma: PrismaClient | null = null;
let testPrisma: PrismaClient | null = null;
let lastUrl: string | null = null;

function getTestPrisma(): PrismaClient {
  const currentUrl = getDatabaseUrl();
  if (testPrisma && lastUrl === currentUrl) return testPrisma;
  if (testPrisma) testPrisma.$disconnect().catch(() => {});
  testPrisma = createPrismaClient();
  lastUrl = currentUrl;
  return testPrisma;
}

// Export prisma - lazy in test mode, cached in non-test mode
export const prisma: PrismaClient = (() => {
  if (isTest) {
    // In test mode, return a Proxy that creates client on first property access
    // This delays Prisma client creation until TEST_DATABASE_URL is set
    return new Proxy({} as PrismaClient, {
      get(_target, prop) {
        const client = getTestPrisma();
        const value = (client as any)[prop];
        // If it's a method, bind it to the client
        return typeof value === "function" ? value.bind(client) : value;
      },
    });
  } else {
    // In non-test mode, cache the instance
    if (!cachedPrisma) {
      cachedPrisma = createPrismaClient();
      globalForPrisma.prisma = cachedPrisma;
    }
    return cachedPrisma;
  }
})();

// TODO: Possible graceful shutdown handler
