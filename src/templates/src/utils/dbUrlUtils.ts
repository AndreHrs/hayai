/**
 * URL helpers used by test database utilities
 * - Factored out for reuse and readability
 */

/**
 * Normalize test ID to a safe identifier
 */
export function normalizeTestId(testId: string): string {
  return testId.toLowerCase().replace(/[^a-z0-9]/gi, "-");
}

/**
 * Get base root name from database name (removes suffixes)
 */
export function getBaseRoot(dbName: string | undefined): string | undefined {
  if (!dbName) return dbName;
  return dbName.includes("-") ? dbName.split("-")[0] : dbName;
}

/**
 * Extract database name from URL
 */
export function getDbNameFromUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const path = u.pathname.replace(/^\//, "");
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Build SQLite URL with a new database name
 */
export function buildSqliteUrl(dbName: string): string {
  // Remove .db extension if present, we'll add it
  const cleanName = dbName.replace(/\.db$/, "");
  return `file:./${cleanName}.db`;
}

/**
 * Build URL with new database name (for PostgreSQL/MySQL)
 */
export function buildUrlWithDbName(
  baseUrl: string,
  dbName: string
): string {
  try {
    const u = new URL(baseUrl);
    u.pathname = `/${dbName}`;
    return u.toString();
  } catch {
    return baseUrl; // fallback
  }
}

/**
 * Append suffix to database name in URL
 */
export function appendSuffix(baseUrl: string, suffix: string): string {
  try {
    const u = new URL(baseUrl);
    const currentPath = u.pathname.replace(/^\//, "");
    const newPath = currentPath ? `${currentPath}${suffix}` : suffix.replace(/^\//, "");
    u.pathname = `/${newPath}`;
    return u.toString();
  } catch {
    return baseUrl; // fallback to original
  }
}

/**
 * Detect database provider from URL
 */
export function detectFromUrl(
  dbUrl: string
): "sqlite" | "postgresql" | "mysql" {
  if (dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://")) {
    return "postgresql";
  }
  if (dbUrl.startsWith("mysql://")) {
    return "mysql";
  }
  // Default to sqlite for file: URLs or if not specified
  return "sqlite";
}

/**
 * Get provider from URL (uses detectFromUrl)
 */
export function getProviderFromUrl(
  url: string
): "sqlite" | "postgresql" | "mysql" {
  return detectFromUrl(url);
}
