/**
 * Test file-specific database configuration
 * Each test file should call setupTestFileDatabase() with a unique identifier
 * to ensure it gets its own isolated database
 */

import { $ } from "bun";
import { getDatabaseProvider } from "../config/env";
import {
  normalizeTestId,
  getDbNameFromUrl,
  appendSuffix,
  buildSqliteUrl,
  getProviderFromUrl,
} from "../utils/dbUrlUtils";

/**
 * Get the test database URL for a specific test identifier
 * - If PARALLEL_TEST=True: Creates separate databases per test file
 * - If PARALLEL_TEST is not True: Uses TEST_DATABASE_URL as-is (shared database) or DATABASE_URL with "-test" suffix
 * @param testId - Unique identifier for the test file (e.g., "user", "post")
 */
export function getTestFileDatabaseUrl(testId: string): string {
  const parallelTest =
    process.env.PARALLEL_TEST?.toLowerCase() === "true" ||
    process.env.PARALLEL_TEST === "True";

  const provider = getDatabaseProvider();
  const normalized = normalizeTestId(testId);
  const testDbUrl = process.env.TEST_DATABASE_URL;
  const baseDbUrl = process.env.DATABASE_URL || "";
  const originalTestDbUrl = process.env.ORIGINAL_TEST_DATABASE_URL || "";

  // Case 1 & 5: Shared mode with TEST_DATABASE_URL provided
  if (!parallelTest && testDbUrl) {
    return testDbUrl;
  }

  // Case 2 & 6: Shared mode without TEST_DATABASE_URL - use DATABASE_URL with "-test" suffix
  if (!parallelTest && !testDbUrl) {
    if (provider === "sqlite") {
      const dbName = getDbNameFromUrl(baseDbUrl);
      const baseName = dbName ? dbName.replace(/\.db$/, "") : "dev";
      return buildSqliteUrl(`${baseName}-test`);
    }
    // PostgreSQL/MySQL: append "-test" to database name
    if (baseDbUrl) {
      return appendSuffix(baseDbUrl, "-test");
    }
    // Fallback if no DATABASE_URL
    return provider === "postgresql"
      ? `postgresql://postgres:postgres@localhost:5432/test`
      : `mysql://root:password@localhost:3306/test`;
  }

  // Parallel mode: append testId suffix
  // Case 3 & 7: Parallel mode with TEST_DATABASE_URL provided
  if (parallelTest && testDbUrl) {
    // Use ORIGINAL_TEST_DATABASE_URL if available to avoid double appending
    const base = originalTestDbUrl || testDbUrl;
    if (provider === "sqlite") {
      const dbName = getDbNameFromUrl(base);
      const baseName = dbName ? dbName.replace(/\.db$/, "") : "test";
      return buildSqliteUrl(`${baseName}-${normalized}`);
    }
    return appendSuffix(base, `-${normalized}`);
  }

  // Case 4 & 8: Parallel mode without TEST_DATABASE_URL - use DATABASE_URL with testId suffix
  if (parallelTest && !testDbUrl) {
    const base = originalTestDbUrl || baseDbUrl;
    if (provider === "sqlite") {
      const dbName = getDbNameFromUrl(base);
      const baseName = dbName ? dbName.replace(/\.db$/, "") : "dev";
      return buildSqliteUrl(`${baseName}-${normalized}`);
    }
    // PostgreSQL/MySQL: append testId suffix
    if (base) {
      return appendSuffix(base, `-${normalized}`);
    }
    // Fallback if no base URL
    return provider === "postgresql"
      ? `postgresql://postgres:postgres@localhost:5432/test-${normalized}`
      : `mysql://root:password@localhost:3306/test-${normalized}`;
  }

  // Should never reach here, but fallback
  return buildSqliteUrl(`test-${normalized}`);
}

/**
 * Set up a test database for a specific test identifier
 * - If PARALLEL_TEST=True: Creates separate database for this test file
 * - Else: Uses shared TEST_DATABASE_URL
 * Should be called in each test file's beforeAll hook
 * @param testId - Unique identifier for this test file (e.g., "user", "post")
 */
export async function setupTestFileDatabase(testId: string): Promise<void> {
  const provider = getProviderFromUrl(process.env.DATABASE_URL || "");
  const parallelTest =
    process.env.PARALLEL_TEST?.toLowerCase() === "true" ||
    process.env.PARALLEL_TEST === "True";

  // IMPORTANT: Derive db URL using ORIGINAL_TEST_DATABASE_URL as base when available
  const dbUrl = getTestFileDatabaseUrl(testId);

  // Set the database URL BEFORE Prisma client is initialized
  process.env.TEST_DATABASE_URL = dbUrl;

  try {
    // Sync schema using Prisma db push with main schema
    await $`bunx prisma db push --schema=./prisma/schema.prisma --skip-generate --accept-data-loss`
      .env({
        DATABASE_URL: dbUrl,
      })
      .quiet();

    const dbDisplay =
      provider === "sqlite"
        ? dbUrl.replace("file:", "")
        : dbUrl.split("@")[1] || dbUrl;
    const mode = parallelTest ? "parallel" : "shared";
    console.log(
      `[Setup] Test database synced (${provider}, ${mode}): ${dbDisplay}`
    );
  } catch (error) {
    console.warn(
      `[Setup] Schema sync warning for ${testId} (${provider}):`,
      error
    );
  }
}

// Track created test databases for cleanup
const createdTestDatabases = new Set<string>();

/**
 * Call this at the top level of test files (before imports that use Prisma)
 * This ensures the database URL is set before Prisma client is created
 * Stores the original TEST_DATABASE_URL to avoid double-appending test identifiers
 * @param testId - Unique identifier for this test file (e.g., "user", "post")
 */
export function configureTestFileDatabase(testId: string): void {
  if (
    process.env.TEST_DATABASE_URL &&
    !process.env.ORIGINAL_TEST_DATABASE_URL
  ) {
    process.env.ORIGINAL_TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
  }

  const dbUrl = getTestFileDatabaseUrl(testId);
  process.env.TEST_DATABASE_URL = dbUrl;

  const parallelTest =
    process.env.PARALLEL_TEST?.toLowerCase() === "true" ||
    process.env.PARALLEL_TEST === "True";
  if (parallelTest) {
    createdTestDatabases.add(dbUrl);
  }
}

/**
 * Drop a PostgreSQL database
 */
async function dropPostgresDatabase(dbUrl: string): Promise<void> {
  const dbName = getDbNameFromUrl(dbUrl);
  if (!dbName) return;

  // Connect to postgres database (default) to drop the test database
  let adminUrl = dbUrl;
  try {
    const u = new URL(dbUrl);
    u.pathname = "/postgres";
    adminUrl = u.toString();
  } catch {
    // keep original if URL parsing fails
  }

  try {
    // Create a temporary Prisma client connected to postgres database
    const { PrismaClient } = await import("@prisma/client");
    const adminClient = new PrismaClient({
      datasources: {
        db: {
          url: adminUrl,
        },
      },
    });

    try {
      // Terminate active connections to the database first (required in PostgreSQL)
      await adminClient.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = '${dbName}' AND pid <> pg_backend_pid();`
      );

      // Drop the database
      await adminClient.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${dbName}";`
      );

      console.log(`[Cleanup] Dropped PostgreSQL database: ${dbName}`);
    } finally {
      await adminClient.$disconnect();
    }
  } catch (error) {
    console.warn(
      `[Cleanup] Failed to drop PostgreSQL database ${dbName}:`,
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Drop a MySQL database
 */
async function dropMysqlDatabase(dbUrl: string): Promise<void> {
  const dbName = getDbNameFromUrl(dbUrl);
  if (!dbName) return;

  // MySQL can drop databases from any connection, but we'll connect without specifying a database
  let adminUrl = dbUrl;
  try {
    const u = new URL(dbUrl);
    u.pathname = "/";
    adminUrl = u.toString();
  } catch {
    // keep original if URL parsing fails
  }

  try {
    // Create a temporary Prisma client
    const { PrismaClient } = await import("@prisma/client");
    const adminClient = new PrismaClient({
      datasources: {
        db: {
          url: adminUrl,
        },
      },
    });

    try {
      // Drop the database
      await adminClient.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS \`${dbName}\`;`
      );

      console.log(`[Cleanup] Dropped MySQL database: ${dbName}`);
    } finally {
      await adminClient.$disconnect();
    }
  } catch (error) {
    console.warn(
      `[Cleanup] Failed to drop MySQL database ${dbName}:`,
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Delete SQLite database file
 */
async function deleteSqliteDatabase(dbUrl: string): Promise<void> {
  try {
    const dbPath = dbUrl.replace("file:", "");
    const { unlink } = await import("fs/promises");
    await unlink(dbPath);
    console.log(`[Cleanup] Deleted SQLite database: ${dbPath}`);
  } catch (error: any) {
    // Ignore "file not found" errors
    if (error.code !== "ENOENT") {
      console.warn(
        `[Cleanup] Failed to delete SQLite database ${dbUrl}:`,
        error
      );
    }
  }
}

/**
 * Clean up all test databases created during tests
 * Drops PostgreSQL/MySQL databases and deletes SQLite files
 */
export async function cleanupTestDatabases(): Promise<void> {
  const parallelTest =
    process.env.PARALLEL_TEST?.toLowerCase() === "true" ||
    process.env.PARALLEL_TEST === "True";

  // Only cleanup if parallel testing was used (individual databases)
  // For shared databases, we don't drop them (user might want to keep data)
  if (!parallelTest) {
    return;
  }

  if (createdTestDatabases.size === 0) {
    return;
  }

  console.log(
    `[Cleanup] Cleaning up ${createdTestDatabases.size} test database(s)...`
  );

  // Convert Set to Array for backward compatibility (no downlevelIteration needed)
  const databasesToCleanup = Array.from(createdTestDatabases);
  const cleanupTasks: Record<string, (url: string) => Promise<void>> = {
    postgresql: dropPostgresDatabase,
    mysql: dropMysqlDatabase,
    sqlite: deleteSqliteDatabase,
  };

  for (const dbUrl of databasesToCleanup) {
    const providerKey = getProviderFromUrl(dbUrl) as keyof typeof cleanupTasks;
    const task = cleanupTasks[providerKey];
    if (task) {
      await task(dbUrl);
    }
  }

  createdTestDatabases.clear();
}
