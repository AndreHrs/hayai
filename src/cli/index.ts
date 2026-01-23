#!/usr/bin/env bun
import {
  writeFileSync,
  existsSync,
  readdirSync,
  copyFileSync,
  readFileSync,
} from "fs";
import { resolve, dirname } from "path";
import { parse } from "dotenv";
import {
  parseHayaiJson,
  buildRenderContext,
  generateControllerSource,
  generateRoutesSource,
  generateSchemaSource,
  renderTemplate,
  pluralize,
  toModuleNames,
  generateSamplePayload,
  resolveRoutePaths,
} from "../core/generator";
import type { HayaiConfig } from "../interfaces/hayai";
import { upsertModel, removeModel, listGeneratedModels } from "../core/prisma";
import { writeGeneratedFileSync, ensureDir, copyDir } from "../utils/fs";
import { log } from "../utils/log";
import { readTemplateCached } from "../utils/templateCache";
import { MARKERS } from "../constants/markers";
import { TEMPLATES_DIR } from "../constants/paths";
import { MESSAGES } from "../constants/messages";

const envTemplatesRoot = Bun.env.HAYAI_TEMPLATES_ROOT
  ? resolve(Bun.env.HAYAI_TEMPLATES_ROOT)
  : null;

const defaultTemplatesRoot = resolve(
  dirname(process.execPath),
  "..",
  "src",
  "templates"
);

const distTemplatesRoot = resolve(
  dirname(process.execPath),
  "..",
  "dist",
  "templates"
);

let TEMPLATES_ROOT = envTemplatesRoot;

if (!TEMPLATES_ROOT) {
  // Try default path first, then fallback to dist path
  if (existsSync(defaultTemplatesRoot)) {
    TEMPLATES_ROOT = defaultTemplatesRoot;
  } else if (existsSync(distTemplatesRoot)) {
    TEMPLATES_ROOT = distTemplatesRoot;
  } else {
    TEMPLATES_ROOT = defaultTemplatesRoot; // Will be used for error message
  }
}

if (!existsSync(TEMPLATES_ROOT)) {
  log.error("Hayai templates directory not found.");
  log.error(
    `Looked for: ${envTemplatesRoot ?? defaultTemplatesRoot}`
  );
  if (envTemplatesRoot) {
    log.error(
      `Environment override HAYAI_TEMPLATES_ROOT="${Bun.env.HAYAI_TEMPLATES_ROOT}" was provided but not found.`
    );
  } else {
    log.error(
      `Tried: ${defaultTemplatesRoot}`
    );
    log.error(
      `Tried: ${distTemplatesRoot}`
    );
    log.error(
      `Ensure the templates directory exists relative to the Hayai binary or set HAYAI_TEMPLATES_ROOT accordingly.`
    );
  }
  process.exit(1);
}

function usage() {
  log.info(MESSAGES.usage);
}

function copyEnvExample(cwd: string) {
  const example = resolve(TEMPLATES_ROOT, "env.example");
  const dest = resolve(cwd, ".env");
  if (existsSync(example) && !existsSync(dest)) {
    copyFileSync(example, dest);
    log.success(`Created ${dest} from templates env.example`);
  }
}

function parseEnvFile(cwd: string): Record<string, string> {
  const envPath = resolve(cwd, ".env");
  if (!existsSync(envPath)) return {};
  const content = readFileSync(envPath, "utf8");
  return parse(content);
}

function inferPrismaProviderFromEnv(env: Record<string, string>): string {
  const explicit = (env["DATABASE_TYPE"] || "").toLowerCase();
  if (explicit) return explicit;
  const url = (env["DATABASE_URL"] || "").toLowerCase();
  if (url.startsWith("postgres")) return "postgresql";
  if (url.startsWith("mysql")) return "mysql";
  if (url.includes("file:")) return "sqlite";
  return "sqlite";
}

function ensurePrismaHeader(cwd: string, provider: string) {
  const schemaPath = resolve(cwd, "prisma/schema.prisma");
  if (existsSync(schemaPath)) return;
  const header =
    `generator client {\n  provider = "prisma-client-js"\n}\n\n` +
    `datasource db {\n  provider = \"${provider}\"\n  url      = env(\"DATABASE_URL\")\n}\n`;
  const dir = resolve(cwd, "prisma");
  ensureDir(dir);
  writeFileSync(schemaPath, header, "utf8");
}

async function initProject(cwd: string, opts?: { overwritePkg?: boolean }) {
  const srcFrom = resolve(TEMPLATES_ROOT, "src");
  const prismaFrom = resolve(TEMPLATES_ROOT, "prisma");
  const srcTo = resolve(cwd, "src");
  const prismaTo = resolve(cwd, "prisma");
  ensureDir(srcTo);
  ensureDir(prismaTo);
  copyDir(srcFrom, srcTo);
  copyDir(prismaFrom, prismaTo);
  copyEnvExample(cwd);
  const env = parseEnvFile(cwd);
  const provider = inferPrismaProviderFromEnv(env);
  ensurePrismaHeader(cwd, provider);
  // Ensure User model exists in prisma schema
  const schemaPath = resolve(cwd, "prisma/schema.prisma");
  const userConfigPath = resolve(
    TEMPLATES_ROOT,
    "static",
    "user.config.json"
  );
  let userConfig: HayaiConfig;
  try {
    const raw = readFileSync(userConfigPath, "utf8");
    userConfig = JSON.parse(raw) as HayaiConfig;
  } catch (error) {
    log.error(`Failed to load user config from ${userConfigPath}: ${error}`);
    throw error;
  }
  upsertModel(schemaPath, userConfig, false);
  // Copy template package.json
  const tplPkg = resolve(TEMPLATES_ROOT, "package.json");
  const outPkg = resolve(cwd, "package.json");
  if (existsSync(tplPkg)) {
    if (!existsSync(outPkg)) {
      copyFileSync(tplPkg, outPkg);
      log.success(`Copied package.json`);
    } else if (opts?.overwritePkg) {
      copyFileSync(tplPkg, outPkg);
      log.success(`Copied package.json (overwritten)`);
    } else {
      // prompt user to confirm overwrite
      const rl = (await import("readline/promises")).createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const ans = (
        await rl.question(
          `package.json already exists. Overwrite with template? [y/N]: `
        )
      )
        .trim()
        .toLowerCase();
      rl.close();
      if (ans === "y" || ans === "yes") {
        copyFileSync(tplPkg, outPkg);
        log.success(`Copied package.json (overwritten)`);
      } else {
        log.info(`Skipped package.json (existing kept)`);
      }
    }
  }
  log.success(`Initialized project at ${cwd}`);
}

function scaffoldModuleJson(cwd: string, name: string) {
  const { ModuleName, moduleName } = toModuleNames(name);
  const templatesDir = resolve(cwd, TEMPLATES_DIR);
  ensureDir(templatesDir);
  const file = resolve(templatesDir, `${moduleName}.hayai.json`);
  if (existsSync(file)) {
    log.error(`Refusing to overwrite existing ${moduleName}.hayai.json`);
    process.exit(1);
  }
  const tplPath = resolve(TEMPLATES_ROOT, "static/scaffold.hayai.json");
  const tpl = readTemplateCached(tplPath);
  if (!tpl) {
    log.error(`Failed to load template: ${tplPath}`);
    process.exit(1);
  }
  const rendered = renderTemplate(tpl, {
    ModuleName,
    moduleName,
    tableName: pluralize(moduleName),
    projectName: "",
  });
  writeGeneratedFileSync(
    file,
    rendered + (rendered.endsWith("\n") ? "" : "\n")
  );
  log.success(`Created ${moduleName}.hayai.json in ${TEMPLATES_DIR}/`);
}

/* --------------------------- Build Helpers --------------------------- */

/**
 * Ensures an export line exists in a barrel file.
 */
function ensureExportLine(filePath: string, line: string): void {
  const exists = existsSync(filePath);
  const content = exists ? readFileSync(filePath, "utf8") : "";
  if (!content.includes(line)) {
    const newContent = content.trimEnd() + (content ? "\n" : "") + line + "\n";
    ensureDir(dirname(filePath));
    writeFileSync(filePath, newContent, "utf8");
  }
}

/**
 * Ensures import and route registration in the main app index file.
 */
function ensureImportAndRoute(
  appIndexPath: string,
  moduleName: string,
  basePath: string
): void {
  if (!existsSync(appIndexPath)) return;
  let s = readFileSync(appIndexPath, "utf8");
  const importLine = `import ${moduleName}Routes from "./routes/${moduleName}Routes";`;
  const routeLine = `app.route("/api/${basePath}", ${moduleName}Routes);`;

  // Insert import: prefer IMPORT_ROUTES anchor, else after last import
  if (!s.includes(importLine)) {
    const importAnchor = MARKERS.importRoutes;
    if (s.includes(importAnchor)) {
      const idx = s.indexOf(importAnchor) + importAnchor.length;
      s = s.slice(0, idx) + "\n" + importLine + "\n" + s.slice(idx);
    } else {
      const lines = s.split(/\r?\n/);
      let lastImport = -1;
      for (let i = 0; i < lines.length; i++)
        if (lines[i].startsWith("import ")) lastImport = i;
      lines.splice(lastImport + 1, 0, importLine);
      s = lines.join("\n");
    }
  }

  // Insert route: prefer API_ROUTES anchor, else before notFound, else append
  if (!s.includes(routeLine)) {
    const apiAnchor = MARKERS.apiRoutes;
    const notFoundAnchor = "app.notFound(";
    if (s.includes(apiAnchor)) {
      const idx = s.indexOf(apiAnchor) + apiAnchor.length;
      s = s.slice(0, idx) + "\n" + routeLine + "\n" + s.slice(idx);
    } else if (s.includes(notFoundAnchor)) {
      const anchor = s.indexOf(notFoundAnchor);
      const head = s.slice(0, anchor).trimEnd();
      const tail = s.slice(anchor);
      s = head + "\n" + routeLine + "\n\n" + tail;
    } else {
      s = s.trimEnd() + "\n" + routeLine + "\n";
    }
  }

  writeFileSync(appIndexPath, s, "utf8");
}

/**
 * Resolves the configured primary key field name for a module.
 */
function getPrimaryFieldName(cfg: HayaiConfig): string {
  return cfg.fields.find((f) => f.primary)?.name || "id";
}

/**
 * Builds dependency creation lines for test files when relations exist.
 */
function buildDependencyLines(
  cfg: HayaiConfig,
  cwd: string,
  ctx: ReturnType<typeof buildRenderContext>
): string[] {
  const depLines: string[] = [];
  const templatesDir = resolve(cwd, TEMPLATES_DIR);

  for (const f of cfg.fields) {
    if (!f.relation || f.relation === "User.id") continue;
    const targetModel = f.relation.split(".")[0];
    const { moduleName: targetModule } = toModuleNames(targetModel);
    const relatedJson = resolve(templatesDir, `${targetModule}.hayai.json`);
    if (!existsSync(relatedJson)) continue;

    try {
      const rcfg = JSON.parse(readFileSync(relatedJson, "utf8")) as HayaiConfig;
      const rCreatePaths = resolveRoutePaths(rcfg, targetModule, "create", "/");
      const relatedCreatePath = rCreatePaths.full;

      // Build first-level nested dependencies for rcfg (exclude User.id)
      const nestedCreates: string[] = [];
      for (const rf of rcfg.fields) {
        if (!rf.relation || rf.relation === "User.id") continue;
        const nestedModel = rf.relation.split(".")[0];
        const { moduleName: nestedModule } = toModuleNames(nestedModel);
        const nestedJson = resolve(templatesDir, `${nestedModule}.hayai.json`);
        if (!existsSync(nestedJson)) continue;
        const ncfg = JSON.parse(
          readFileSync(nestedJson, "utf8")
        ) as HayaiConfig;
        const nestedPk = getPrimaryFieldName(ncfg);
        const nestedCreatePaths = resolveRoutePaths(
          ncfg,
          nestedModule,
          "create",
          "/"
        );
        const nPayload = generateSamplePayload(ncfg, {
          includeRelations: false,
        });
        nestedCreates.push(
          `    // create nested related ${nestedModel}\n` +
          `    const ${nestedModule}Res = await app.request("${nestedCreatePaths.full}", { method: "POST", headers: getAuthHeaders(authToken), body: JSON.stringify(${JSON.stringify(
            nPayload
          )}) });\n` +
          `    const ${nestedModule}Data = await ${nestedModule}Res.json();\n` +
          `    const ${nestedModule}Id = ${nestedModule}Data.data?.${nestedModule}?.${nestedPk} || ${nestedModule}Data.data?.${nestedPk};\n` +
          `    ${targetModule}Payload["${rf.name}"] = ${nestedModule}Id;\n`
        );
      }

      const relatedPk = getPrimaryFieldName(rcfg);
      const rPayload = generateSamplePayload(rcfg, { includeRelations: false });
      depLines.push(
        `    // create related ${targetModel}\n` +
        `    const ${targetModule}Payload = ${JSON.stringify(rPayload)};\n` +
        nestedCreates.join("") +
        `    const ${targetModule}Res = await app.request("${relatedCreatePath}", { method: "POST", headers: getAuthHeaders(authToken), body: JSON.stringify(${targetModule}Payload) });\n` +
        `    const ${targetModule}Data = await ${targetModule}Res.json();\n` +
        `    const ${targetModule}Id = ${targetModule}Data.data?.${targetModule}?.${relatedPk} || ${targetModule}Data.data?.${relatedPk};\n` +
        `    payload["${f.name}"] = ${targetModule}Id;\n`
      );
    } catch (err) {
      log.error(`Failed to parse related config ${relatedJson}: ${err}`);
    }
  }

  return depLines;
}

/**
 * Builds validator test cases from field validators.
 */
function buildValidatorBlock(cfg: HayaiConfig, createPath: string): string {
  const cases: Array<{ name: string; body: Record<string, any> }> = [];
  cases.push({ name: "missing required fields", body: {} });

  for (const f of cfg.fields) {
    if (!f.validator || f.validator.length === 0) continue;
    for (const r of f.validator) {
      const body: Record<string, any> = {};
      let val: any = "";
      if (f.type === "String") {
        if (r === "email") val = "not-an-email";
        else if (r === "alphanum") val = "abc-!";
        else if (r === "number_only") val = "abc";
        else if (r === "alpha_only") val = "abc123";
        else if (r.startsWith("length>=")) {
          const n = parseInt(r.split(">=")[1] || "1", 10);
          val = "x".repeat(Math.max(1, n - 1));
        } else if (r.startsWith("length<=")) {
          const n = parseInt(r.split("<=")[1] || "1", 10);
          val = "x".repeat(n + 1);
        } else if (r === "contain_number") val = "NoDigits";
        else if (r === "contain_symbol") val = "Alpha123";
      } else {
        if (r.startsWith("min>="))
          val = parseInt(r.split(">=")[1] || "1", 10) - 1;
        else if (r.startsWith("max<="))
          val = parseInt(r.split("<=")[1] || "1", 10) + 1;
        else val = "invalid";
      }
      body[f.name] = val;
      cases.push({ name: `${f.name}:${r}`, body });
    }
  }

  return [
    `it("should fail validators", async () => {`,
    `  const cases = ${JSON.stringify(cases)};`,
    `  for (const c of cases) {`,
    `    const res = await app.request("${createPath}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c.body) });`,
    `    expect([400,401]).toContain(res.status);`,
    `  }`,
    `});`,
  ].join("\n");
}

/* --------------------------- Build Functions --------------------------- */

/**
 * Builds controller source file for a module.
 */
async function buildControllers(
  cfg: HayaiConfig,
  ctx: ReturnType<typeof buildRenderContext>,
  outputRoot: string,
  ask: (path: string) => Promise<boolean>,
  overwriteAll: boolean
): Promise<void> {
  const ctrlDest = resolve(
    outputRoot,
    `controllers/${ctx.moduleName}Controller.ts`
  );
  const ctrlOverwrite =
    overwriteAll || (existsSync(ctrlDest) ? await ask(ctrlDest) : true);
  if (ctrlOverwrite) {
    try {
      const src = generateControllerSource(cfg, ctx.ModuleName, ctx.moduleName);
      writeGeneratedFileSync(ctrlDest, src);
    } catch (err) {
      log.error(`Failed to generate controller for ${cfg.name}: ${err}`);
      throw err;
    }
  }
}

/**
 * Builds routes source file for a module.
 */
async function buildRoutes(
  cfg: HayaiConfig,
  ctx: ReturnType<typeof buildRenderContext>,
  outputRoot: string,
  ask: (path: string) => Promise<boolean>,
  overwriteAll: boolean
): Promise<void> {
  const routesDest = resolve(outputRoot, `routes/${ctx.moduleName}Routes.ts`);
  const routesOverwrite =
    overwriteAll || (existsSync(routesDest) ? await ask(routesDest) : true);
  if (routesOverwrite) {
    try {
      const src = generateRoutesSource(cfg, ctx.ModuleName, ctx.moduleName);
      writeGeneratedFileSync(routesDest, src);
    } catch (err) {
      log.error(`Failed to generate routes for ${cfg.name}: ${err}`);
      throw err;
    }
  }
}

/**
 * Builds schema source file for a module.
 */
async function buildSchemas(
  cfg: HayaiConfig,
  ctx: ReturnType<typeof buildRenderContext>,
  outputRoot: string,
  ask: (path: string) => Promise<boolean>,
  overwriteAll: boolean
): Promise<void> {
  const schemaDest = resolve(outputRoot, `schemas/${ctx.moduleName}Schema.ts`);
  const schemaOverwrite =
    overwriteAll || (existsSync(schemaDest) ? await ask(schemaDest) : true);
  if (schemaOverwrite) {
    try {
      const src = generateSchemaSource(cfg, ctx.ModuleName);
      writeGeneratedFileSync(schemaDest, src);
    } catch (err) {
      log.error(`Failed to generate schema for ${cfg.name}: ${err}`);
      throw err;
    }
  }
}

/**
 * Builds test source file for a module.
 */
async function buildTests(
  cfg: HayaiConfig,
  ctx: ReturnType<typeof buildRenderContext>,
  outputRoot: string,
  cwd: string,
  ask: (path: string) => Promise<boolean>,
  overwriteAll: boolean
): Promise<void> {
  const testsDest = resolve(outputRoot, `tests/${ctx.moduleName}.test.ts`);
  const testsOverwrite =
    overwriteAll || (existsSync(testsDest) ? await ask(testsDest) : true);
  if (testsOverwrite) {
    try {
      const tplPath = resolve(TEMPLATES_ROOT, "adaptive/test.hayai");
      const tpl = readTemplateCached(tplPath);
      if (!tpl) {
        log.error(`Failed to load test template: ${tplPath}`);
        return;
      }

      let base = renderTemplate(tpl, { ...ctx });

      // Generate a valid payload from required fields
      const valid = generateSamplePayload(cfg, { includeRelations: false });

      // Build dependency creates for non-User relations
      const depLines = buildDependencyLines(cfg, cwd, ctx);

      // Build validator cases
      const createPaths = resolveRoutePaths(cfg, ctx.moduleName, "create", "/");
      const validatorBlock = buildValidatorBlock(cfg, createPaths.full);

      // Replace sections in adaptive template
      const pkField = cfg.fields.find((f) => f.primary)?.name || "id";
      base = base
        .replace("{{SECTION_VALID_PAYLOAD}}", JSON.stringify(valid))
        .replace("{{SECTION_DEPENDENCIES_CREATE}}", depLines.join(""))
        .replace("{{SECTION_VALIDATORS}}", validatorBlock)
        .replace(
          /createdId\s*=\s*data\.data\?\.[a-zA-Z0-9_]+\?\.id\s*\|\|\s*data\.data\?\.id\s*;/,
          `createdId = data.data?.${ctx.moduleName}?.${pkField} || data.data?.${pkField};`
        );

      // Build tests strictly from configured routes
      const routesCfg = cfg.routes || ({} as any);
      const itBlocks: string[] = [];
      const formatPathLiteral = (fullPath: string): string => {
        if (!fullPath.includes(":")) return `"${fullPath}"`;
        const replaced = fullPath.replace(/:([A-Za-z0-9_]+)/, "${createdId}");
        return `\`${replaced}\``;
      };

      if (routesCfg["create"]) {
        itBlocks.push(
          `  it("should reject creating without authentication", async () => {\n` +
          `    const response = await app.request("${createPaths.full}", {\n` +
          `      method: "POST",\n` +
          `      headers: { "Content-Type": "application/json" },\n` +
          `      body: JSON.stringify({}),\n` +
          `    });\n` +
          `    expect([401,400]).toContain(response.status);\n` +
          `  });\n\n` +
          `  it("should fail validation when required fields missing", async () => {\n` +
          `    const response = await app.request("${createPaths.full}", {\n` +
          `      method: "POST",\n` +
          `      headers: getAuthHeaders(authToken),\n` +
          `      body: JSON.stringify({}),\n` +
          `    });\n` +
          `    expect(response.status).toBe(400);\n` +
          `    const data = await response.json();\n` +
          `    expect(data).toHaveProperty("success", false);\n` +
          `    expect(data).toHaveProperty("message", "Validation failed");\n` +
          `    expect(data).toHaveProperty("data");\n` +
          `  });\n\n` +
          `  it("should create a new ${ctx.moduleName}", async () => {\n` +
          `    const payload = ${JSON.stringify(valid)} as any;\n` +
          (depLines.length ? depLines.join("") : "") +
          `    const response = await app.request("${createPaths.full}", {\n` +
          `      method: "POST",\n` +
          `      headers: getAuthHeaders(authToken),\n` +
          `      body: JSON.stringify(payload),\n` +
          `    });\n` +
          `    expect([200,201]).toContain(response.status);\n` +
          `    const data = await response.json();\n` +
          `    expect(data).toHaveProperty("success", true);\n` +
          `    expect(data.data).toBeDefined();\n` +
          `    createdId = data.data?.${ctx.moduleName}?.${pkField} || data.data?.${pkField};\n` +
          `  });\n`
        );
      }
      if (routesCfg["get-all"]) {
        const pluralName = pluralize(ctx.moduleName);
        const getAllPaths = resolveRoutePaths(
          cfg,
          ctx.moduleName,
          "get-all",
          "/"
        );
        itBlocks.push(
          `  it("should list items", async () => {\n` +
          `    const res = await app.request("${getAllPaths.full}", { method: "GET" });\n` +
          `    expect(res.status).toBe(200);\n` +
          `    const data = await res.json();\n` +
          `    expect(Array.isArray(data.data?.${pluralName} || data.data?.items || [])).toBe(true);\n` +
          `  });\n`
        );
      }
      if (routesCfg["get-single"]) {
        const getSinglePaths = resolveRoutePaths(
          cfg,
          ctx.moduleName,
          "get-single",
          `/:${pkField}`
        );
        const getSingleLiteral = formatPathLiteral(getSinglePaths.full);
        itBlocks.push(
          `  it("should get single item by id", async () => {\n` +
          `    const res = await app.request(${getSingleLiteral}, { method: "GET" });\n` +
          `    expect([200,404]).toContain(res.status);\n` +
          `  });\n`
        );
      }
      if (routesCfg["update"]) {
        const updatePaths = resolveRoutePaths(
          cfg,
          ctx.moduleName,
          "update",
          `/:${pkField}`
        );
        const updateLiteral = formatPathLiteral(updatePaths.full);
        itBlocks.push(
          `  it("should update item", async () => {\n` +
          `    const res = await app.request(${updateLiteral}, {\n` +
          `      method: "PUT",\n` +
          `      headers: getAuthHeaders(authToken),\n` +
          `      body: JSON.stringify({}),\n` +
          `    });\n` +
          `    expect([200,400,403]).toContain(res.status);\n` +
          `  });\n`
        );
      }
      if (routesCfg["delete"]) {
        const deletePaths = resolveRoutePaths(
          cfg,
          ctx.moduleName,
          "delete",
          `/:${pkField}`
        );
        const deleteLiteral = formatPathLiteral(deletePaths.full);
        itBlocks.push(
          `  it("should delete item", async () => {\n` +
          `    const res = await app.request(${deleteLiteral}, { method: "DELETE", headers: getAuthHeaders(authToken) });\n` +
          `    expect([200,403,404]).toContain(res.status);\n` +
          `  });\n`
        );
      }
      if (routesCfg["update-admin"]) {
        const adminUpdatePaths = resolveRoutePaths(
          cfg,
          ctx.moduleName,
          "update-admin",
          `/admin/:${pkField}`
        );
        const adminUpdateLiteral = formatPathLiteral(adminUpdatePaths.full);
        itBlocks.push(
          `  it("should reject admin update without admin role", async () => {\n` +
          `    const res = await app.request(${adminUpdateLiteral}, { method: "PUT", headers: getAuthHeaders(authToken), body: JSON.stringify({}) });\n` +
          `    expect([403,401,400]).toContain(res.status);\n` +
          `  });\n`
        );
      }
      if (routesCfg["delete-admin"]) {
        const adminDeletePaths = resolveRoutePaths(
          cfg,
          ctx.moduleName,
          "delete-admin",
          `/admin/:${pkField}`
        );
        const adminDeleteLiteral = formatPathLiteral(adminDeletePaths.full);
        itBlocks.push(
          `  it("should reject admin delete without admin role", async () => {\n` +
          `    const res = await app.request(${adminDeleteLiteral}, { method: "DELETE", headers: getAuthHeaders(authToken) });\n` +
          `    expect([403,401]).toContain(res.status);\n` +
          `  });\n`
        );
      }

      // Rebuild file using header + conditional tests + validators
      const headerUntilDescribe = tpl.split('describe("')[0];
      const rebuilt = [
        renderTemplate(headerUntilDescribe, { ...ctx }),
        `describe("${ctx.ModuleName} CRUD Operations", () => {\n  let testUser: any;\n  let authToken: string;\n  let createdId: string = "";\n\n  beforeAll(async () => {\n    testUser = await createTestUser();\n    authToken = testUser.token;\n  });\n\n  afterAll(async () => {\n    if (testUser) {\n      await cleanupTestUser(testUser.email);\n    }\n  });\n\n`,
        itBlocks.join("\n"),
        `\n  //SECTION::VALIDATOR_CASES\n${validatorBlock}\n});\n`,
      ].join("");
      base = rebuilt;

      writeGeneratedFileSync(testsDest, base);
    } catch (err) {
      log.error(`Failed to generate tests for ${cfg.name}: ${err}`);
      throw err;
    }
  }
}

/**
 * Updates Prisma schema with model definitions.
 */
async function updatePrisma(
  schemaPath: string,
  cfgs: HayaiConfig[],
  existing: string[],
  overwriteAll: boolean,
  interactive: boolean,
  rl: any
): Promise<void> {
  const willTouch = cfgs.map((c) => c.name).filter((n) => existing.includes(n));

  let prismaOverwriteAll = overwriteAll;
  if (!overwriteAll && interactive && willTouch.length > 0) {
    const ans = (
      await rl!.question(
        `Models ${willTouch.join(
          ", "
        )} already exists in schema, overwrite? [a]ll/[n]o/[i]nteractive: `
      )
    )
      .trim()
      .toLowerCase();
    if (ans === "a" || ans === "all") prismaOverwriteAll = true;
    else if (ans === "n" || ans === "no") prismaOverwriteAll = false;
    else if (ans === "i" || ans === "interactive") prismaOverwriteAll = false; // per-model below
  }

  for (const cfg of cfgs) {
    let doOverwrite = prismaOverwriteAll || overwriteAll;
    if (!doOverwrite && interactive && existing.includes(cfg.name)) {
      const ans = (
        await rl!.question(`Overwrite Prisma model ${cfg.name}? [y]es/[n]o: `)
      )
        .trim()
        .toLowerCase();
      doOverwrite = ans === "y" || ans === "yes";
    }
    try {
      const up = upsertModel(schemaPath, cfg, doOverwrite);
      const prismaMsg =
        up.action === "appended"
          ? "appended"
          : up.action === "replaced"
            ? "replaced"
            : "already exists";
      log.success(`Built module ${cfg.name}. Prisma model ${prismaMsg}.`);
    } catch (err) {
      log.error(`Failed to update Prisma model ${cfg.name}: ${err}`);
      throw err;
    }
  }

  // Schema sanitation: remove orphan generated models not represented by current hayai.json files (keep User)
  const desired = new Set<string>(cfgs.map((c) => c.name).concat(["User"]));
  for (const m of listGeneratedModels(schemaPath)) {
    if (!desired.has(m)) {
      removeModel(schemaPath, m);
    }
  }
}

async function buildOne(
  cwd: string,
  name?: string,
  opts?: { force?: boolean; interactive?: boolean }
) {
  const outputRoot = resolve(cwd, "src");
  const schemaPath = resolve(cwd, "prisma/schema.prisma");
  ensureDir(outputRoot);

  let overwriteAll = Boolean(opts?.force);
  const interactiveDefault = opts?.interactive !== false && !overwriteAll;
  const interactive = interactiveDefault;
  const rl = interactive
    ? (await import("readline/promises")).createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    : null;
  const ask = async (path: string): Promise<boolean> => {
    if (!interactive) return true;
    if (overwriteAll) return true;
    const ans = (await rl!.question(`Overwrite ${path}? [y]es/[n]o/[a]ll: `))
      .trim()
      .toLowerCase();
    if (ans === "a" || ans === "all") {
      overwriteAll = true;
      return true;
    }
    if (ans === "y" || ans === "yes") return true;
    return false;
  };

  // Collect targets from templates directory
  // cwd should be the project root where the command is executed (not the package directory)
  const templatesDir = resolve(cwd, TEMPLATES_DIR);
  if (!existsSync(templatesDir)) {
    log.error(`${TEMPLATES_DIR} directory not found at ${templatesDir}`);
    log.info(`Current working directory (process.cwd()): ${cwd}`);
    log.info(`Looking for templates in: ${templatesDir}`);
    log.info(
      `Please run "bun hayai module:add moduleName" or create directory ${TEMPLATES_DIR} and move existing .hayai.json files there`
    );
    process.exit(1);
  }

  let targets: string[] = [];
  if (name) {
    const { moduleName } = toModuleNames(name);
    const targetFile = resolve(templatesDir, `${moduleName}.hayai.json`);
    if (!existsSync(targetFile)) {
      log.error(
        `Template ${moduleName}.hayai.json not found in ${TEMPLATES_DIR}/`
      );
      process.exit(1);
    }
    targets = [targetFile];
  } else {
    const files = readdirSync(templatesDir)
      .filter((f) => f.endsWith(".hayai.json"))
      .map((f) => resolve(templatesDir, f));

    if (files.length === 0) {
      log.warn(`No hayai templates found in ${TEMPLATES_DIR}/ directory`);
      return;
    }

    targets = files;
  }

  // Build code files and collect configs
  const cfgs: HayaiConfig[] = [];
  for (const file of targets) {
    try {
      const cfg = parseHayaiJson(file);
      const projectName = dirname(dirname(cwd)).split("/").pop() || "hayai-app";
      const ctx = buildRenderContext(projectName, cfg);

      // Build all module files
      await buildControllers(cfg, ctx, outputRoot, ask, overwriteAll);
      await buildRoutes(cfg, ctx, outputRoot, ask, overwriteAll);
      await buildSchemas(cfg, ctx, outputRoot, ask, overwriteAll);
      await buildTests(cfg, ctx, outputRoot, cwd, ask, overwriteAll);

      // Ensure latest base test utilities are in place
      const baseTestTpl = resolve(TEMPLATES_ROOT, "src/tests/baseTest.ts");
      const baseTestOut = resolve(outputRoot, "tests/baseTest.ts");
      const shouldWriteBaseTest =
        overwriteAll ||
        !existsSync(baseTestOut) ||
        (existsSync(baseTestOut) ? await ask(baseTestOut) : false);
      if (existsSync(baseTestTpl) && shouldWriteBaseTest) {
        const baseContent = readFileSync(baseTestTpl, "utf8");
        writeFileSync(baseTestOut, baseContent, "utf8");
      }

      // Update barrel files
      ensureExportLine(
        resolve(outputRoot, "controllers/index.ts"),
        `export * from "./${ctx.moduleName}Controller";`
      );
      ensureExportLine(
        resolve(outputRoot, "schemas/index.ts"),
        `export * from "./${ctx.moduleName}Schema";`
      );

      // Register routes in app index
      ensureImportAndRoute(
        resolve(outputRoot, "index.ts"),
        ctx.moduleName,
        ctx.tableName
      );

      cfgs.push(cfg);
    } catch (err) {
      log.error(`Failed to build module from ${file}: ${err}`);
      throw err;
    }
  }

  // Update Prisma schema
  const existing = listGeneratedModels(schemaPath);
  await updatePrisma(schemaPath, cfgs, existing, overwriteAll, interactive, rl);

  if (rl) rl.close();
}

async function main() {
  const argv = process.argv.slice(2);

  // get current working directory where command is executed
  const cwd = process.cwd();

  if (argv.length === 0) {
    usage();
    process.exit(1);
  }

  const cmd = argv[0];
  const rest = argv.slice(1);
  const nonFlag = rest.filter((a) => !a.startsWith("-"));
  const flags = new Set(rest.filter((a) => a.startsWith("-")));
  const hasFlag = (k: string) =>
    flags.has(k) || flags.has(k.replace(/^--/, "-"));
  const sub = nonFlag[0];
  if (cmd === "init") {
    await initProject(cwd, {
      overwritePkg: hasFlag("--force") || hasFlag("-f"),
    });
    return;
  }
  if (cmd === "module:add" && sub) {
    scaffoldModuleJson(cwd, sub);
    return;
  }
  if (cmd === "module:remove" && sub) {
    const { ModuleName, moduleName } = toModuleNames(sub);
    const askConfirm = async () => {
      if (hasFlag("--force") || hasFlag("-f")) return true;
      const rl = (await import("readline/promises")).createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const ans = (
        await rl.question(
          `Remove module ${ModuleName}? This deletes files and schema. [y/N]: `
        )
      )
        .trim()
        .toLowerCase();
      rl.close();
      return ans === "y" || ans === "yes";
    };
    if (!(await askConfirm())) return;
    const del = (p: string) => {
      const abs = resolve(cwd, p);
      if (existsSync(abs))
        Bun.spawnSync(["bash", "-lc", `rm -f ${abs.replace(/"/g, '\\"')}`]);
    };
    // Remove template file from templates directory
    const templateFile = resolve(
      cwd,
      TEMPLATES_DIR,
      `${moduleName}.hayai.json`
    );
    if (existsSync(templateFile)) {
      del(`${TEMPLATES_DIR}/${moduleName}.hayai.json`);
    }
    // Remove generated files
    del(`src/controllers/${moduleName}Controller.ts`);
    del(`src/routes/${moduleName}Routes.ts`);
    del(`src/schemas/${moduleName}Schema.ts`);
    del(`src/tests/${moduleName}.test.ts`);
    // Clean barrels
    const ctrlIdx = resolve(cwd, "src/controllers/index.ts");
    if (existsSync(ctrlIdx)) {
      const s = readFileSync(ctrlIdx, "utf8")
        .split(/\r?\n/)
        .filter((l) => !l.includes(`${moduleName}Controller`))
        .join("\n");
      writeFileSync(ctrlIdx, s + "\n", "utf8");
    }
    const schIdx = resolve(cwd, "src/schemas/index.ts");
    if (existsSync(schIdx)) {
      const s = readFileSync(schIdx, "utf8")
        .split(/\r?\n/)
        .filter((l) => !l.includes(`${moduleName}Schema`))
        .join("\n");
      writeFileSync(schIdx, s + "\n", "utf8");
    }
    // Clean app index imports and route
    const appIdx = resolve(cwd, "src/index.ts");
    if (existsSync(appIdx)) {
      let s = readFileSync(appIdx, "utf8");
      const importLine = `import ${moduleName}Routes from "./routes/${moduleName}Routes";`;
      s = s.split(importLine).join("");
      // Try both pluralized and original - route uses ctx.tableName which may be from config
      const pluralRoute = pluralize(moduleName);
      s = s
        .split(`app.route("/api/${pluralRoute}", ${moduleName}Routes);`)
        .join("");
      s = s
        .split(`app.route("/api/${moduleName}s", ${moduleName}Routes);`)
        .join("");
      s = s.replace(/\n{3,}/g, "\n\n");
      writeFileSync(appIdx, s, "utf8");
    }
    // Remove prisma model
    removeModel(resolve(cwd, "prisma/schema.prisma"), ModuleName);
    log.success(`Removed module ${ModuleName}`);
    return;
  }
  if (cmd === "module:build") {
    await buildOne(cwd, sub, {
      force: hasFlag("--force") || hasFlag("-f"),
      interactive: !hasFlag("--no-interactive"),
    });
    return;
  }
  usage();
  process.exit(1);
}

main();
