import { prisma } from "../db";
import { app } from "../index";

export interface TestUser {
  email: string;
  username: string;
  password: string;
}

export interface TestUserResult {
  id: string;
  email: string;
  username: string;
  token: string;
  role?: string;
}

/**
 * Generates unique test user data with timestamp-based identifiers
 */
export function generateTestUserData(): TestUser {
  const timestamp = Date.now();
  return {
    email: `test-${timestamp}@example.com`,
    username: `testuser-${timestamp}`,
    password: "testpassword123!",
  };
}

/**
 * Creates a test user via the signup endpoint
 * Returns user data and JWT token
 */
export async function createTestUser(
  userData?: Partial<TestUser>,
): Promise<TestUserResult> {
  const testUser = userData
    ? { ...generateTestUserData(), ...userData }
    : generateTestUserData();

  const response = await app.request("/api/auth/signup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(testUser),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create test user: ${JSON.stringify(error)}`);
  }

  const data = await response.json();

  return {
    id: data.data.user.id,
    email: data.data.user.email,
    username: data.data.user.username,
    token: data.data.token,
    role: data.data.user.role || "USER",
  };
}

/**
 * Logs in a test user and returns JWT token
 */
export async function loginTestUser(
  email: string,
  password: string,
): Promise<string> {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to login test user: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return data.data.token;
}

/**
 * Creates Authorization headers with Bearer token
 */
export function getAuthHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Cleans up all test data created during tests
 * Removes users with email starting with "test-"
 */
export async function cleanupTestData(): Promise<void> {
  const anyPrisma: any = prisma as any;
  // Try to clear dependent records broadly to avoid schema coupling
  if (anyPrisma.book?.deleteMany) {
    try { await anyPrisma.book.deleteMany({}); } catch {}
  }
  if (anyPrisma.author?.deleteMany) {
    try { await anyPrisma.author.deleteMany({}); } catch {}
  }

  // Delete test users
  try {
    await prisma.user.deleteMany({
      where: { email: { startsWith: "test-" } },
    });
  } catch {}
}

/**
 * Cleans up a specific user by email
 */
export async function cleanupTestUser(email: string): Promise<void> {
  const anyPrisma: any = prisma as any;
  const user = await prisma.user.findUnique({ where: { email } }).catch(() => null);
  if (user) {
    if (anyPrisma.book?.deleteMany) {
      try { await anyPrisma.book.deleteMany({}); } catch {}
    }
    if (anyPrisma.author?.deleteMany) {
      try { await anyPrisma.author.deleteMany({}); } catch {}
    }
  }

  await prisma.user.delete({ where: { email } }).catch(() => {});
}

