// IMPORTANT: Set up test database BEFORE any Prisma imports
import { configureTestFileDatabase, setupTestFileDatabase } from "./testFileDatabase";
configureTestFileDatabase("user");

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { app } from "../index";
import {
  generateTestUserData,
  createTestUser,
  loginTestUser,
  cleanupTestUser,
  getAuthHeaders,
  type TestUserResult,
} from "./baseTest";
import { prisma } from "../db";

// Set up isolated database schema for this test file
beforeAll(async () => {
  await setupTestFileDatabase("user");
});

describe("User Authentication", () => {
  let testUser: TestUserResult;

  // Global setup handles cleanup before all tests
  // No need for redundant cleanupTestData() call here

  afterAll(async () => {
    // Clean up test user
    if (testUser) {
      await cleanupTestUser(testUser.email);
    }
  });

  it("should sign up a new user", async () => {
    const userData = generateTestUserData();

    const response = await app.request("/api/auth/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(userData),
    });

    expect(response.status).toBe(201);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(data).toHaveProperty("message", "User created successfully");
    expect(data).toHaveProperty("data");
    expect(data.data).toHaveProperty("user");
    expect(data.data.user).toHaveProperty("email", userData.email);
    expect(data.data.user).toHaveProperty("username", userData.username);
    expect(data.data.user).toHaveProperty("id");
    expect(data.data.user).toHaveProperty("role", "USER");
    expect(data.data).toHaveProperty("token");
    expect(typeof data.data.token).toBe("string");
    expect(data.data.token.length).toBeGreaterThan(0);

    // Store user data for cleanup
    testUser = {
      id: data.data.user.id,
      email: data.data.user.email,
      username: data.data.user.username,
      token: data.data.token,
      role: data.data.user.role,
    };
  });

  it("should log in with valid credentials", async () => {
    const userData = generateTestUserData();
    await createTestUser(userData);

    const token = await loginTestUser(userData.email, userData.password);

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    // Cleanup
    await cleanupTestUser(userData.email);
  });

  it("should reject login with invalid email", async () => {
    const userData = generateTestUserData();

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "nonexistent@example.com",
        password: userData.password,
      }),
    });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data).toHaveProperty("success", false);
    expect(data).toHaveProperty("message", "Invalid credentials");
  });

  it("should reject login with invalid password", async () => {
    const userData = generateTestUserData();
    const createdUser = await createTestUser(userData);

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: userData.email,
        password: "wrongpassword",
      }),
    });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data).toHaveProperty("success", false);
    expect(data).toHaveProperty("message", "Invalid credentials");

    // Cleanup
    await cleanupTestUser(createdUser.email);
  });

  it("should reject signup with duplicate email", async () => {
    const userData = generateTestUserData();
    const createdUser = await createTestUser(userData);

    const response = await app.request("/api/auth/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: userData.email,
        username: `different-${Date.now()}`,
        password: userData.password,
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty("success", false);
    expect(data).toHaveProperty(
      "message",
      "User with this email already exists",
    );

    // Cleanup
    await cleanupTestUser(createdUser.email);
  });

  it("should reject signup with duplicate username", async () => {
    const userData = generateTestUserData();
    const createdUser = await createTestUser(userData);

    const response = await app.request("/api/auth/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: `different-${Date.now()}@example.com`,
        username: userData.username,
        password: userData.password,
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty("success", false);
    expect(data).toHaveProperty(
      "message",
      "User with this username already exists",
    );

    // Cleanup
    await cleanupTestUser(createdUser.email);
  });

  it("should reject signup with missing fields", async () => {
    const response = await app.request("/api/auth/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "test@example.com",
        // Missing username and password
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty("success", false);
    expect(data).toHaveProperty("message", "Validation failed");
    expect(data).toHaveProperty("data");
    expect(data.data).toHaveProperty("VALIDATION");
    // Check that username and password are in validation errors
    expect(data.data.VALIDATION).toHaveProperty("username");
    expect(data.data.VALIDATION).toHaveProperty("password");
  });
});

describe("User CRUD - Authenticated User", () => {
  let testUser: TestUserResult;
  let authToken: string;

  beforeAll(async () => {
    testUser = await createTestUser();
    authToken = testUser.token;
  });

  afterAll(async () => {
    if (testUser) {
      await cleanupTestUser(testUser.email);
    }
  });

  it("should get current user profile", async () => {
    const response = await app.request("/api/auth/me", {
      method: "GET",
      headers: getAuthHeaders(authToken),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(data).toHaveProperty("data");
    expect(data.data).toHaveProperty("user");
    expect(data.data.user).toHaveProperty("id", testUser.id);
    expect(data.data.user).toHaveProperty("email", testUser.email);
    expect(data.data.user).toHaveProperty("username", testUser.username);
    expect(data.data.user).toHaveProperty("role", "USER");
  });

  it("should update current user profile", async () => {
    const updateData = {
      username: `updated-${Date.now()}`,
    };

    const response = await app.request("/api/auth/me", {
      method: "PUT",
      headers: getAuthHeaders(authToken),
      body: JSON.stringify(updateData),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(data).toHaveProperty("message", "User updated successfully");
    expect(data.data).toHaveProperty("user");
    expect(data.data.user).toHaveProperty("username", updateData.username);
  });

  it("should reject update without authentication", async () => {
    const response = await app.request("/api/auth/me", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "newusername" }),
    });

    expect(response.status).toBe(401);
  });

  it("should delete current user account", async () => {
    const userToDelete = await createTestUser();
    const userId = userToDelete.id;

    const response = await app.request("/api/auth/me", {
      method: "DELETE",
      headers: getAuthHeaders(userToDelete.token),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("success", true);
    expect(data).toHaveProperty("message", "User deleted successfully");

    // Verify user is deleted from database
    const deletedUser = await prisma.user.findUnique({
      where: { id: userId },
    });
    expect(deletedUser).toBeNull();
  });
});

describe("User CRUD - Admin Access", () => {
  let adminUser: TestUserResult;
  let regularUser: TestUserResult;
  let adminToken: string;

  beforeAll(async () => {
    // Create regular user
    regularUser = await createTestUser();

    // Create admin user by directly updating role in database
    const adminUserData = generateTestUserData();
    adminUser = await createTestUser(adminUserData);
    await prisma.user.update({
      where: { id: adminUser.id },
      data: { role: "ADMIN" as any },
    });

    // Create admin token directly with ADMIN role
    const { signJWT } = await import("../utils");
    adminToken = await signJWT({
      userId: adminUser.id,
      email: adminUser.email,
      role: "ADMIN",
    });
  });

  afterAll(async () => {
    if (regularUser) {
      await cleanupTestUser(regularUser.email).catch(() => {});
    }
    if (adminUser) {
      await cleanupTestUser(adminUser.email).catch(() => {});
    }
  });

  it("should get all users (admin only)", async () => {
    const response = await app.request("/api/auth/users", {
      method: "GET",
      headers: getAuthHeaders(adminToken),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(data).toHaveProperty("data");
    expect(data.data).toHaveProperty("users");
    expect(Array.isArray(data.data.users)).toBe(true);
    expect(data.data.users.length).toBeGreaterThan(0);
  });

  it("should reject get all users without admin role", async () => {
    const response = await app.request("/api/auth/users", {
      method: "GET",
      headers: getAuthHeaders(regularUser.token),
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data).toHaveProperty("success", false);
    expect(data).toHaveProperty("message", "Admin access required");
  });

  it("should get user by ID (admin only)", async () => {
    const response = await app.request(`/api/auth/users/${regularUser.id}`, {
      method: "GET",
      headers: getAuthHeaders(adminToken),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(data.data).toHaveProperty("user");
    expect(data.data.user).toHaveProperty("id", regularUser.id);
    expect(data.data.user).toHaveProperty("email", regularUser.email);
  });

  it("should update user by ID (admin only)", async () => {
    const updateData = {
      username: `admin-updated-${Date.now()}`,
    };

    const response = await app.request(`/api/auth/users/${regularUser.id}`, {
      method: "PUT",
      headers: getAuthHeaders(adminToken),
      body: JSON.stringify(updateData),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(data).toHaveProperty("message", "User updated successfully");
    expect(data.data).toHaveProperty("user");
    expect(data.data.user).toHaveProperty("username", updateData.username);
  });

  it("should update user role (admin only)", async () => {
    const testUser = await createTestUser();
    const updateData = {
      role: "ADMIN",
    };

    const response = await app.request(`/api/auth/users/${testUser.id}`, {
      method: "PUT",
      headers: getAuthHeaders(adminToken),
      body: JSON.stringify(updateData),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(data.data).toHaveProperty("user");
    expect(data.data.user).toHaveProperty("role", "ADMIN");

    // Cleanup
    await cleanupTestUser(testUser.email);
  });

  it("should delete user by ID (admin only)", async () => {
    const userToDelete = await createTestUser();

    const response = await app.request(`/api/auth/users/${userToDelete.id}`, {
      method: "DELETE",
      headers: getAuthHeaders(adminToken),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("success", true);
    expect(data).toHaveProperty("message", "User deleted successfully");
  });

  it("should reject admin operations without admin role", async () => {
    const userToView = await createTestUser();

    const response = await app.request(`/api/auth/users/${userToView.id}`, {
      method: "GET",
      headers: getAuthHeaders(regularUser.token),
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data).toHaveProperty("success", false);
    expect(data).toHaveProperty("message", "Admin access required");

    // Cleanup
    await cleanupTestUser(userToView.email);
  });
});
