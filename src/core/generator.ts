import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { renderTemplate } from "../utils/template";
import { writeGeneratedFileSync } from "../utils/fs";
import { log } from "../utils/log";
import { readTemplateCached } from "../utils/templateCache";

import type {
  HayaiField,
  HayaiConfig,
  RenderContext,
} from "../interfaces/hayai";

export function parseHayaiJson(jsonPath: string): HayaiConfig {
  const filePath = resolve(jsonPath);
  if (!existsSync(filePath)) {
    log.error(`Hayai config file not found: ${filePath}`);
    throw new Error(`Config file not found: ${filePath}`);
  }
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed as HayaiConfig;
  } catch (err) {
    log.error(`Failed to parse Hayai config ${filePath}: ${err}`);
    throw err;
  }
}

export function toModuleNames(name: string): {
  ModuleName: string;
  moduleName: string;
} {
  const ModuleName = name.slice(0, 1).toUpperCase() + name.slice(1);
  const moduleName = name.slice(0, 1).toLowerCase() + name.slice(1);
  return { ModuleName, moduleName };
}

/**
 * Pluralizes a word following common English rules
 * - Words ending in 'y' after a consonant -> 'ies' (utility -> utilities)
 * - Words ending in 's', 'x', 'z', 'ch', 'sh' -> 'es' (box -> boxes, class -> classes)
 * - Words ending in 'f' or 'fe' -> 'ves' (knife -> knives, leaf -> leaves)
 * - Most other words -> 's' (user -> users, post -> posts)
 */
export function pluralize(word: string): string {
  const lower = word.toLowerCase();
  // Words ending in 'y' after a consonant -> 'ies'
  if (lower.endsWith("y") && !/[aeiou]y$/.test(lower)) {
    return word.slice(0, -1) + "ies";
  }
  // Words ending in 's', 'x', 'z', 'ch', 'sh' -> 'es'
  if (
    lower.endsWith("s") ||
    lower.endsWith("x") ||
    lower.endsWith("z") ||
    lower.endsWith("ch") ||
    lower.endsWith("sh")
  ) {
    return word + "es";
  }
  // Words ending in 'f' -> 'ves' (but not 'ff' like 'staff' -> 'staffs')
  if (lower.endsWith("f") && !lower.endsWith("ff")) {
    return word.slice(0, -1) + "ves";
  }
  // Words ending in 'fe' -> 'ves'
  if (lower.endsWith("fe")) {
    return word.slice(0, -2) + "ves";
  }
  // Default: add 's'
  return word + "s";
}

export function buildRenderContext(
  projectName: string,
  cfg: HayaiConfig
): RenderContext {
  const { ModuleName, moduleName } = toModuleNames(cfg.name);
  return {
    projectName,
    ModuleName,
    moduleName,
    tableName: cfg.table_name ?? pluralize(moduleName),
  };
}

export { renderTemplate };

export function resolveRoutePaths(
  cfg: HayaiConfig,
  moduleName: string,
  routeKey: string,
  fallbackLocal: string,
  pkField?: string
): { local: string; full: string } {
  const baseSegment = `/${cfg.table_name ?? pluralize(moduleName)}`;
  const routeCfg = cfg.routes?.[routeKey] as { endpoint?: string } | undefined;
  let endpoint = routeCfg?.endpoint?.trim();
  if (!endpoint) {
    const local = fallbackLocal;
    const normalizedLocal = normalizeParam(local, pkField);
    return {
      local: normalizedLocal,
      full:
        normalizedLocal === "/"
          ? normalizeParam(`/api${baseSegment}`, pkField)
          : normalizeParam(`/api${baseSegment}${normalizedLocal}`, pkField),
    };
  }
  if (!endpoint.startsWith("/")) endpoint = `/${endpoint}`;
  const hasApiPrefix = endpoint.startsWith("/api/");
  let pathWithoutApi = hasApiPrefix ? endpoint.slice(4) : endpoint;
  if (!pathWithoutApi.startsWith("/")) pathWithoutApi = `/${pathWithoutApi}`;
  let local = pathWithoutApi;
  if (pathWithoutApi.startsWith(baseSegment)) {
    local = pathWithoutApi.slice(baseSegment.length);
    if (!local.startsWith("/")) local = local ? `/${local}` : "/";
    if (!local) local = "/";
  } else if (!local.startsWith("/")) {
    local = `/${local}`;
  }
  if (!local) local = "/";
  const normalizedLocal = normalizeParam(local, pkField);
  const full = hasApiPrefix
    ? normalizeParam(endpoint, pkField)
    : pathWithoutApi.startsWith(baseSegment)
      ? normalizeParam(`/api${pathWithoutApi}`, pkField)
      : normalizeParam(
        `/api${baseSegment}${normalizedLocal === "/" ? "" : normalizedLocal}`,
        pkField
      );
  return { local: normalizedLocal, full };

  function normalizeParam(path: string, pk?: string): string {
    if (!pk) return path;
    const regex = /:id\b/gi;
    return path.replace(regex, `:${pk}`);
  }
}

export interface WriteTemplateOptions {
  templatePath: string;
  outputPath: string;
  context: RenderContext;
  overwrite?: boolean;
}

export function renderFileTo(target: WriteTemplateOptions): string {
  const { templatePath, outputPath, context, overwrite } = target;
  const template = readTemplateCached(resolve(templatePath));
  if (!template) {
    log.error(`Template not found: ${templatePath}`);
    return outputPath;
  }
  const rendered = renderTemplate(template, context);
  const absOut = resolve(outputPath);
  if (!overwrite && existsSync(absOut)) {
    return absOut;
  }
  writeGeneratedFileSync(absOut, rendered);
  return absOut;
}

// Adaptive generators
let validatorMapCache: any | null = null;
function loadValidatorMap(): any {
  if (validatorMapCache) return validatorMapCache;
  const mapPath = resolve(__dirname, "../templates/maps/validator.json");
  try {
    const raw = readFileSync(mapPath, "utf8");
    validatorMapCache = JSON.parse(raw);
  } catch {
    validatorMapCache = {};
  }
  return validatorMapCache;
}

function applyRuleTemplate(base: string, rule: string, type: string): string {
  const map = loadValidatorMap();
  const typeMap = map[type] || {};
  // exact match
  if (typeMap[rule]) return base + typeMap[rule];
  // parameterized rules: find prefix keys ending with >= or <=
  for (const key of Object.keys(typeMap)) {
    if (key.endsWith(">=") && rule.startsWith(key)) {
      const n = rule.slice(key.length);
      const tpl = String(typeMap[key]).replace(
        "{{n}}",
        String(parseInt(n || "", 10))
      );
      return base + tpl;
    }
    if (key.endsWith("<=") && rule.startsWith(key)) {
      const n = rule.slice(key.length);
      const tpl = String(typeMap[key]).replace(
        "{{n}}",
        String(parseInt(n || "", 10))
      );
      return base + tpl;
    }
  }
  return base;
}

function buildZodLine(f: HayaiField, forUpdate: boolean): string {
  let base = (() => {
    switch (f.type) {
      case "String":
        return "z.string()";
      case "Int":
        return "z.number().int()";
      case "Float":
        return "z.number()";
      case "Boolean":
        return "z.boolean()";
      case "DateTime":
        return "z.string()"; // ISO string format
      default:
        return "z.any()";
    }
  })();
  // apply validators via external map
  if (Array.isArray(f.validator)) {
    for (const ruleRaw of f.validator) {
      const r = String(ruleRaw).trim();
      if (!r) continue;
      base = applyRuleTemplate(base, r, f.type);
    }
  }
  const required = !forUpdate && (f.required || f.primary) ? "" : ".optional()";
  return `  ${f.name}: ${base}${required},`;
}

export function generateSchemaSource(
  cfg: HayaiConfig,
  ModuleName: string
): string {
  const createLines = cfg.fields
    .filter((f) => {
      if (f.relation === "User.id") return false; // filled from auth context
      return !f.primary || (f.primary && !f.default);
    })
    .map((f) => buildZodLine(f, false));
  const updateLines = cfg.fields
    .filter((f) => !f.forbid_update)
    .map((f) => buildZodLine(f, true));

  const templatesRoot = resolve(__dirname, "../templates");
  const schemaTplPath = resolve(templatesRoot, "adaptive/schema.hayai");
  const schemaTpl = readTemplateCached(schemaTplPath);
  if (!schemaTpl) {
    log.error(`Schema template not found: ${schemaTplPath}`);
    return "";
  }

  const context: RenderContext = {
    ModuleName,
    SECTION_CREATE_FIELDS: createLines.join("\n"),
    SECTION_UPDATE_FIELDS: updateLines.join("\n"),
  };

  return renderTemplate(schemaTpl, context);
}

function formatControllerDefault(f: HayaiField): string {
  const raw = f.default?.trim();
  if (!raw) return "";
  if (f.type === "String") {
    const quoted = /^["'`].*["'`]$/.test(raw);
    const looksLikeFunction = /^[A-Za-z_$][\w$]*\s*\(.*\)$/.test(raw);
    if (!quoted && looksLikeFunction) return raw;
    const normalized = quoted ? raw.slice(1, -1) : raw;
    return JSON.stringify(normalized);
  }
  return raw;
}

function buildCreateDataAssignments(fields: HayaiField[]): string[] {
  const lines: string[] = [];
  for (const f of fields) {
    if (f.primary && f.default) continue; // generated by db
    if (f.relation === "User.id") {
      lines.push(`      ${f.name}: c.userId!,`);
      continue;
    }
    const src = `body.${f.name}`;
    if (f.store_hashed) {
      lines.push(`      ${f.name}: await hashPassword(${src} as string),`);
    } else if (f.default && !f.required) {
      const fallback = formatControllerDefault(f);
      lines.push(`      ${f.name}: ${src} ?? ${fallback},`);
    } else {
      lines.push(`      ${f.name}: ${src} as any,`);
    }
  }
  return lines;
}

function buildUpdateStripForbidden(fields: HayaiField[]): string[] {
  const lines: string[] = [];
  for (const f of fields) {
    if (!f.forbid_update) continue;
    lines.push(`      delete data["${f.name}"];`);
  }
  return lines;
}

function buildUpdateHashAssignments(fields: HayaiField[]): string[] {
  const lines: string[] = [];
  for (const f of fields) {
    if (!f.store_hashed || f.forbid_update) continue;
    lines.push(
      [
        `      if (typeof data["${f.name}"] === "string" && data["${f.name}"]) {`,
        `        data["${f.name}"] = await hashPassword(data["${f.name}"] as string);`,
        `      }`,
      ].join("\n")
    );
  }
  return lines;
}

function buildHideFieldsSnippet(
  varName: string,
  fields: HayaiField[]
): string[] {
  const hidden = fields.filter((f) => f.hide_from_get).map((f) => f.name);
  if (hidden.length === 0) return [];
  return [
    `    const scrub = (obj: any) => { if (!obj) return obj; ${hidden
      .map((n) => `delete obj["${n}"];`)
      .join(" ")} return obj; };`,
    `    if (Array.isArray(${varName})) { ${varName} = ${varName}.map((x: any) => (scrub(x), x)); } else { scrub(${varName}); }`,
  ];
}

export function generateControllerSource(
  cfg: HayaiConfig,
  ModuleName: string,
  moduleName: string
): string {
  const createAssignments = buildCreateDataAssignments(cfg.fields).join("\n");
  const updateStripForbidden = buildUpdateStripForbidden(cfg.fields).join("\n");
  const updateHashAssignments = buildUpdateHashAssignments(cfg.fields).join("\n");
  const hideSingle = buildHideFieldsSnippet(moduleName, cfg.fields).join("\n");
  const pluralModuleName = pluralize(moduleName);
  const hideMany = buildHideFieldsSnippet(pluralModuleName, cfg.fields).join(
    "\n"
  );
  const pkField = cfg.fields.find((f) => f.primary)?.name || "id";
  const hasUserIdField = cfg.fields.some((f) => f.name === "userId");
  // Check ownership for both regular and admin routes
  const wantUpdateOwnership =
    (Boolean(cfg.routes?.["update"]?.check_ownership) ||
      Boolean(cfg.routes?.["update-admin"]?.check_ownership)) &&
    hasUserIdField;
  const wantDeleteOwnership =
    (Boolean(cfg.routes?.["delete"]?.check_ownership) ||
      Boolean(cfg.routes?.["delete-admin"]?.check_ownership)) &&
    hasUserIdField;
  const templatesRoot = resolve(__dirname, "../templates");
  const controllerTplPath = resolve(templatesRoot, "adaptive/controller.hayai");
  const controllerTpl = readTemplateCached(controllerTplPath);
  if (!controllerTpl) {
    log.error(`Controller template not found: ${controllerTplPath}`);
    return "";
  }

  const context: RenderContext = {
    ModuleName,
    moduleName,
    tableName: cfg.table_name ?? pluralModuleName,
    SECTION_IMPORTS_EXTRA: `import { hashPassword } from "../utils/password";`,
    SECTION_CREATE_ASSIGNMENTS: createAssignments,
    SECTION_UPDATE_STRIP_FORBIDDEN: updateStripForbidden,
    SECTION_UPDATE_HASH_ASSIGNMENTS: updateHashAssignments,
    SECTION_HIDE_SINGLE: hideSingle,
    SECTION_HIDE_MANY: hideMany,
    SECTION_PK_NAME: pkField,
    SECTION_PK_JSON: pkField,
  };

  // Load CRUD route mapping
  const crudMapPath = resolve(templatesRoot, "static/crud.route.map.json");
  const rawCrudMap = readTemplateCached(crudMapPath);
  if (!rawCrudMap) {
    throw new Error(`CRUD route map template missing at ${crudMapPath}`);
  }
  const crudMap: Record<
    string,
    {
      template: string;
      exportName: string;
      exportSuffix: string;
      supportsOwnership?: boolean;
    }
  > = JSON.parse(rawCrudMap);

  // Load controller method snippets dynamically
  const routesCfg = cfg.routes || {};
  const methodSnippets: string[] = [];
  const exportLines: string[] = [];

  // Process routes in order: create, get-all, get-single, update, delete
  const routeOrder = ["create", "get-all", "get-single", "update", "delete"];

  for (const routeKey of routeOrder) {
    const routeMap = crudMap[routeKey];
    if (!routeMap) continue;

    // Check if route should be included (for update/delete, also check admin variants)
    const shouldInclude =
      routeKey === "update"
        ? Boolean(routesCfg["update"]) || Boolean(routesCfg["update-admin"])
        : routeKey === "delete"
          ? Boolean(routesCfg["delete"]) || Boolean(routesCfg["delete-admin"])
          : Boolean(routesCfg[routeKey]);

    if (!shouldInclude) continue;

    const templatePath = resolve(templatesRoot, routeMap.template);
    const snippet = readTemplateCached(templatePath);
    if (!snippet) {
      log.warn(`Template not found for route ${routeKey}: ${templatePath}`);
      continue;
    }

    let method = renderTemplate(snippet, context);

    // Inject ownership check if needed
    if (routeMap.supportsOwnership) {
      const wantsOwnership =
        routeKey === "update" ? wantUpdateOwnership : wantDeleteOwnership;
      if (wantsOwnership) {
        method = method.replace(
          `if (!existing) return this.fail(c, "${ModuleName} not found", 404);`,
          `if (!existing) return this.fail(c, "${ModuleName} not found", 404);\n    { const own = this.ensureOwnership(c, (existing as any).userId, "Forbidden - Not owner of ${ModuleName}"); if (own) return own; }`
        );
      }
    }

    methodSnippets.push(method);

    // Generate export line
    const exportFuncName = `${routeMap.exportName}${ModuleName}${routeMap.exportSuffix}`;
    exportLines.push(
      `export const ${exportFuncName} = (c: AuthContext) => ${moduleName}Controller.${exportFuncName}(c);`
    );
  }

  context.SECTION_CRUD_METHODS = methodSnippets.join("\n\n");
  context.SECTION_EXPORTS = exportLines.join("\n");

  let out = renderTemplate(controllerTpl, context);
  return out;
}

export function generateRoutesSource(
  cfg: HayaiConfig,
  ModuleName: string,
  moduleName: string
): string {
  const templatesRoot = resolve(__dirname, "../templates");
  const tplPath = resolve(templatesRoot, "adaptive/routes.hayai");
  const tpl = readTemplateCached(tplPath);
  if (!tpl) {
    log.error(`Routes template not found: ${tplPath}`);
    return "";
  }
  const pkField = cfg.fields.find((f) => f.primary)?.name || "id";
  const linesPublic: string[] = [];
  const linesProtected: string[] = [];
  const routesCfg = cfg.routes || {};

  // Always include basic GETs as public unless explicitly marked auth_required
  const getAllCfg = routesCfg["get-all"]; // GET /
  const getSingleCfg = routesCfg["get-single"]; // GET /:pk
  if (getAllCfg) {
    const path = resolveRoutePaths(
      cfg,
      moduleName,
      "get-all",
      "/",
      pkField
    ).local;
    if (!getAllCfg.auth_required)
      linesPublic.push(
        `${moduleName}Routes.get("${path}", get${ModuleName}s);`
      );
    else
      linesProtected.push(`${moduleName}Routes.use("/*", authMiddleware);`),
        linesProtected.push(
          `${moduleName}Routes.get("${path}", get${ModuleName}s);`
        );
  }
  if (getSingleCfg) {
    const path = resolveRoutePaths(
      cfg,
      moduleName,
      "get-single",
      `/:${pkField}`,
      pkField
    ).local;
    if (!getSingleCfg.auth_required)
      linesPublic.push(
        `${moduleName}Routes.get("${path}", get${ModuleName});`
      );
    else if (
      !linesProtected.includes(`${moduleName}Routes.use("/*", authMiddleware);`)
    )
      linesProtected.push(`${moduleName}Routes.use("/*", authMiddleware);`),
        linesProtected.push(
          `${moduleName}Routes.get("${path}", get${ModuleName});`
        );
  }

  // Protected block if there is at least one protected route
  const needAuth = [
    "create",
    "update",
    "delete",
    "update-admin",
    "delete-admin",
  ].some((k) => routesCfg[k]?.auth_required || k.endsWith("-admin"));
  if (
    needAuth &&
    !linesProtected.includes(`${moduleName}Routes.use("/*", authMiddleware);`)
  )
    linesProtected.unshift(`${moduleName}Routes.use("/*", authMiddleware);`);

  // Map helpers
  const addWithValidation = (
    method: string,
    path: string,
    schema: string,
    handler: string,
    extraMw: string[] = []
  ) => {
    const middle = [...extraMw, `validateSchema(${schema})`, handler].join(
      ", "
    );
    linesProtected.push(`${moduleName}Routes.${method}("${path}", ${middle});`);
  };
  const addNoValidation = (
    method: string,
    path: string,
    handler: string,
    extraMw: string[] = []
  ) => {
    const middle = [...extraMw, handler].join(", ");
    linesProtected.push(`${moduleName}Routes.${method}("${path}", ${middle});`);
  };

  // Standard protected routes if configured (default to enabled when not specified)
  const createCfg = routesCfg["create"]; // POST /
  if (createCfg) {
    const path = resolveRoutePaths(
      cfg,
      moduleName,
      "create",
      "/",
      pkField
    ).local;
    if (
      !linesProtected.includes(`${moduleName}Routes.use("/*", authMiddleware);`)
    )
      linesProtected.unshift(`${moduleName}Routes.use("/*", authMiddleware);`);
    addWithValidation("post", path, `create${ModuleName}Schema`, `create${ModuleName}`);
  }
  const updateCfg = routesCfg["update"]; // PUT /:pk
  if (updateCfg) {
    const path = resolveRoutePaths(
      cfg,
      moduleName,
      "update",
      `/:${pkField}`,
      pkField
    ).local;
    if (
      !linesProtected.includes(`${moduleName}Routes.use("/*", authMiddleware);`)
    )
      linesProtected.unshift(`${moduleName}Routes.use("/*", authMiddleware);`);
    addWithValidation(
      "put",
      path,
      `update${ModuleName}Schema`,
      `update${ModuleName}`
    );
  }
  const deleteCfg = routesCfg["delete"]; // DELETE /:pk
  if (deleteCfg) {
    const path = resolveRoutePaths(
      cfg,
      moduleName,
      "delete",
      `/:${pkField}`,
      pkField
    ).local;
    if (
      !linesProtected.includes(`${moduleName}Routes.use("/*", authMiddleware);`)
    )
      linesProtected.unshift(`${moduleName}Routes.use("/*", authMiddleware);`);
    addNoValidation("delete", path, `delete${ModuleName}`);
  }

  // Admin-only variants if present in config (e.g., update-admin/delete-admin)
  const adminMw: string[] = ["onlyAdminAccess"];
  const adminUpdateCfg = routesCfg["update-admin"];
  const adminDeleteCfg = routesCfg["delete-admin"];
  const hasAdminUpdate = Boolean(adminUpdateCfg?.admin_only);
  const hasAdminDelete = Boolean(adminDeleteCfg?.admin_only);
  if (hasAdminUpdate) {
    const path = resolveRoutePaths(
      cfg,
      moduleName,
      "update-admin",
      `/admin/:${pkField}`,
      pkField
    ).local;
    addWithValidation(
      "put",
      path,
      `update${ModuleName}Schema`,
      `update${ModuleName}`,
      adminMw
    );
  }
  if (hasAdminDelete) {
    const path = resolveRoutePaths(
      cfg,
      moduleName,
      "delete-admin",
      `/admin/:${pkField}`,
      pkField
    ).local;
    addNoValidation(
      "delete",
      path,
      `delete${ModuleName}`,
      adminMw
    );
  }

  let out = tpl
    .replace("{{SECTION_PUBLIC_ROUTES}}", linesPublic.join("\n"))
    .replace("{{SECTION_PROTECTED_ROUTES}}", linesProtected.join("\n"))
    .replace(/\{\{ModuleName\}\}/g, ModuleName)
    .replace(/\{\{moduleName\}\}/g, moduleName);

  // Inject import for onlyAdminAccess when needed
  if (hasAdminUpdate || hasAdminDelete) {
    out = out.replace(
      `import { authMiddleware } from "../middlewares/auth";`,
      `import { authMiddleware } from "../middlewares/auth";\nimport { onlyAdminAccess } from "../middlewares/onlyAdminAccess";`
    );
  }
  return out;
}

/**
 * Generates a sample value for a field based on its type and validators.
 * Used for creating test payloads.
 */
function generateSampleValue(field: HayaiField): any {
  if (field.relation === "User.id") return undefined; // controller sets from c.userId

  const validators = Array.isArray(field.validator) ? field.validator : [];

  switch (field.type) {
    case "String": {
      if (validators.includes("email")) return "valid@example.com";
      if (validators.includes("alphanum")) return "AlphaNum123";
      if (validators.includes("number_only")) return "1234";
      if (validators.includes("alpha_only")) return "Alpha";
      const minLength = validators.find((r: string) =>
        r.startsWith("length>=")
      );
      const len = minLength
        ? Math.max(1, parseInt(minLength.split(">=")[1] || "1", 10))
        : 5;
      return "x".repeat(len);
    }
    case "Boolean":
      return true;
    case "Int":
    case "Float":
      return 1;
    case "DateTime":
      return new Date().toISOString();
    default:
      return null;
  }
}

/**
 * Generates a sample payload from a HayaiConfig.
 * @param cfg - The HayaiConfig to generate payload for
 * @param options - Options for payload generation
 * @returns A record with field names as keys and sample values
 */
export function generateSamplePayload(
  cfg: HayaiConfig,
  options: { includeRelations?: boolean } = {}
): Record<string, any> {
  const payload: Record<string, any> = {};
  const { includeRelations = false } = options;

  for (const field of cfg.fields) {
    if (field.primary) continue;
    if (field.relation === "User.id") continue;
    if (!includeRelations && field.relation) continue;

    if (field.required || includeRelations) {
      const val = generateSampleValue(field);
      if (val !== undefined) {
        payload[field.name] = val;
      }
    }
  }

  return payload;
}

export function generateTestSourceFromConfig(
  cfg: HayaiConfig,
  ModuleName: string,
  moduleName: string
): string {
  const plural = pluralize(moduleName);
  const pkField = cfg.fields.find((f) => f.primary)?.name || "id";
  const invalidBodies: Array<{ name: string; body: Record<string, any> }> = [];
  invalidBodies.push({ name: "missing required fields", body: {} });
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
      invalidBodies.push({ name: `${f.name}:${r}`, body });
    }
  }
  const tplPath = resolve(__dirname, "../templates/adaptive/test.hayai");
  const tpl = readTemplateCached(tplPath);
  if (!tpl) {
    log.error(`Test template not found: ${tplPath}`);
    return "";
  }
  const createPaths = resolveRoutePaths(
    cfg,
    moduleName,
    "create",
    "/",
    pkField
  );
  const fullCreatePath = createPaths.full;
  return tpl
    .replace("{{SECTION_VALID_PAYLOAD}}", "{}")
    .replace("{{SECTION_DEPENDENCIES_CREATE}}", "")
    .replace(
      "{{SECTION_VALIDATORS}}",
      [
        `const cases = ${JSON.stringify(invalidBodies)};`,
        `for (const c of cases) {`,
        `  const res = await app.request("${fullCreatePath}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c.body) });`,
        `  expect([400,401]).toContain(res.status);`,
        `}`,
      ].join("\n")
    )
    .replace(/\{\{ModuleName\}\}/g, ModuleName)
    .replace(/\{\{moduleName\}\}/g, moduleName)
    .replace(/\{\{tableName\}\}/g, plural);
}
