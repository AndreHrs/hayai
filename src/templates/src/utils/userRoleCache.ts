/**
 * User role cache utility
 * Caches user roles to reduce database calls while ensuring role changes are reflected
 */

interface CacheEntry {
  role: string;
  expiresAt: number;
}

const roleCache = new Map<string, CacheEntry>();

/**
 * Parse cache duration from env (in seconds, default 3600)
 */
function getCacheDuration(): number {
  const cacheSeconds = parseInt(process.env.USER_CACHE || "3600", 10);
  return cacheSeconds * 1000; // Convert to milliseconds
}

/**
 * Get user role from cache or null if not cached or expired
 */
export function getCachedRole(userId: string): string | null {
  const entry = roleCache.get(userId);
  if (!entry) return null;
  
  if (Date.now() > entry.expiresAt) {
    // Cache expired, remove it
    roleCache.delete(userId);
    return null;
  }
  
  return entry.role;
}

/**
 * Set user role in cache
 */
export function setCachedRole(userId: string, role: string): void {
  const expiresAt = Date.now() + getCacheDuration();
  roleCache.set(userId, { role, expiresAt });
}

/**
 * Clear cached role for a specific user
 */
export function clearCachedRole(userId: string): void {
  roleCache.delete(userId);
}

/**
 * Clear all cached roles (useful for testing or cache invalidation)
 */
export function clearAllCachedRoles(): void {
  roleCache.clear();
}

