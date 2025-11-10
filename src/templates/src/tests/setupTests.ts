import { beforeAll, afterAll } from "bun:test";
import { cleanupTestData } from "./baseTest";
import { cleanupTestDatabases } from "./testFileDatabase";
import { prisma } from "../db";

/**
 * Global test setup and teardown
 * This file is automatically loaded by Bun's test runner
 * to ensure test data is cleaned up before and after all test suites
 * 
 * Note: Each test file should call setupTestFileDatabase() in its beforeAll
 * hook to set up its own isolated database. This ensures test files can
 * run in parallel without conflicts.
 */

// Run before all test suites
beforeAll(async () => {
  // Ensure we're in test mode
  if (process.env.NODE_ENV !== "test") {
    process.env.NODE_ENV = "test";
  }

  console.log("[Setup] Global test setup ready");
  console.log(
    "[Setup] Note: Each test file should call setupTestFileDatabase() in its beforeAll hook",
  );
});

// Run after all test suites
afterAll(async () => {
  console.log("[Setup] Cleaning up test data after all tests...");
  await cleanupTestData();

  // Close Prisma connection to allow database cleanup
  await prisma.$disconnect();

  // Clean up test databases (for parallel test mode)
  await cleanupTestDatabases();
});