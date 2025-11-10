/**
 * Generate Prisma client for tests
 *
 * This utility:
 * 1. Updates schema.prisma provider to match DATABASE_TYPE or DATABASE_URL
 * 2. Generates Prisma client from the updated schema
 *
 * Ensures the Prisma client matches the database provider being used in tests.
 */

import { $ } from "bun";
import { readFileSync, writeFileSync } from "fs";
import { getDatabaseProvider } from "../config/env";

function updateSchemaProvider(targetProvider?: string): string {
  const provider = targetProvider || getDatabaseProvider();
  const schemaPath = "./prisma/schema.prisma";

  // Safe schema read/write to handle missing file gracefully
  let schemaContent: string | null = null;
  try {
    schemaContent = readFileSync(schemaPath, "utf-8");
  } catch (error) {
    console.warn(
      `[Schema] Warning: Unable to read ${schemaPath}. Skipping provider update.`
    );
    return provider;
  }

  // Update provider in schema if it doesn't match
  const providerRegex = /provider\s*=\s*["'](\w+)["']/;
  const currentMatch = schemaContent.match(providerRegex);
  const currentProvider = currentMatch ? currentMatch[1] : null;

  if (currentProvider !== provider) {
    console.log(
      `[Schema] Updating provider from "${currentProvider}" to "${provider}"`
    );
    const updatedContent = schemaContent.replace(
      providerRegex,
      `provider = "${provider}"`
    );
    try {
      writeFileSync(schemaPath, updatedContent, "utf-8");
      console.log(`[Schema] ✓ Schema provider updated to ${provider}`);
    } catch (error) {
      console.warn(
        `[Schema] Warning: Unable to write ${schemaPath}. Continuing without schema update.`
      );
    }
  } else {
    console.log(`[Schema] ✓ Schema provider already set to ${provider}`);
  }

  return provider;
}

/**
 * Restore schema provider to production settings (from DATABASE_TYPE or DATABASE_URL)
 * Reuses getDatabaseProvider() but with NODE_ENV temporarily cleared
 */
function restoreProductionSchemaProvider(): string {
  // Get production provider (not test environment)
  const originalEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV; // Temporarily clear to get production provider

  // Reuse the existing provider detection logic
  const provider = getDatabaseProvider();

  // Restore NODE_ENV
  if (originalEnv) {
    process.env.NODE_ENV = originalEnv;
  }

  return updateSchemaProvider(provider);
}

/**
 * Generate Prisma client from main schema
 */
async function generateClient(
  restoreProduction = false,
  skipProviderCheck = false
): Promise<void> {
  const mode = restoreProduction ? "production" : "test";

  // Optionally skip provider update/restore
  const provider = skipProviderCheck
    ? getDatabaseProvider()
    : restoreProduction
      ? restoreProductionSchemaProvider()
      : updateSchemaProvider();

  const log = (phase: "start" | "done") => {
    const verb = phase === "start" ? "Generating" : "✓ Prisma client generated";
    const suffix = phase === "start" ? "..." : "";
    console.log(`[Test Setup] ${verb} (${mode}) for ${provider}${suffix}`);
  };

  log("start");
  await $`bunx prisma generate --schema=./prisma/schema.prisma`.quiet();
  log("done");
}

// Check command line arguments
const args = process.argv.slice(2);
const isRestoreMode =
  args.includes("--restore-production") || args.includes("--restore");
const skipProviderCheck =
  args.includes("--skip-provider-check") || args.includes("--skip-provider");

// Run the async function (IIFE pattern for backward compatibility)
// Store the promise to prevent early exit
const promise = generateClient(isRestoreMode, skipProviderCheck).catch(
  (error) => {
    console.error("[Test Setup] Failed to generate Prisma client:", error);
    process.exit(1);
  }
);

// For Bun runtime: ensure the promise is tracked
if (typeof Bun !== "undefined") {
  // Bun automatically tracks top-level promises, but we need to keep reference
  // The process will wait for this promise to resolve
  promise.then(() => {
    // Script completes successfully
  });
}
