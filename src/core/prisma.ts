import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { HayaiConfig, HayaiField } from "../interfaces/hayai";
import { log } from "../utils/log";
import { MARKERS } from "../constants/markers";
import { TEMPLATES_DIR } from "../constants/paths";
import { readTemplateCached } from "../utils/templateCache";
import {
  normalizeModels,
  replaceModelBlock,
  overwriteModelSegments,
} from "./schemaUtils";

let typeMapCache: Record<string, string> | null = null;
let relationRulesCache: Record<string, string> | null = null;

function loadTypeMap(): Record<string, string> {
  if (typeMapCache) return typeMapCache;
  const mapPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "templates",
    "static",
    "prisma.type.map.json"
  );
  try {
    const raw = readFileSync(mapPath, "utf8");
    typeMapCache = JSON.parse(raw);
  } catch {
    typeMapCache = {};
    log.warn(`Failed to load type map from ${mapPath}, using defaults`);
  }
  return typeMapCache || {};
}

function loadRelationRules(): Record<string, string> {
  if (relationRulesCache) return relationRulesCache;
  const rulesPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "templates",
    "static",
    "relation.rules.json"
  );
  try {
    const raw = readFileSync(rulesPath, "utf8");
    relationRulesCache = JSON.parse(raw);
  } catch {
    relationRulesCache = {
      onDelete: "Cascade",
      backRefSuffix: "s",
      defaultRelationField: "Rel",
    };
    log.warn(`Failed to load relation rules from ${rulesPath}, using defaults`);
  }
  return relationRulesCache || {};
}

function mapTypeToPrisma(type: string): string {
  const typeMap = loadTypeMap();
  return typeMap[type] || type;
}

function prismaDefaultClause(
  def?: string,
  type?: string,
  isPrimary = false
): string {
  if (!def) return "";
  if (type === "String") {
    const trimmed = def.trim();
    const alreadyQuoted = /^".*"$/.test(trimmed);
    if (!alreadyQuoted) {
      if (isPrimary && trimmed === "uuid()") {
        return ` @default(${trimmed})`;
      }
      return ` @default("${trimmed.replace(/^"(.*)"$/, "$1")}")`;
    }
  }
  return ` @default(${def})`;
}

function isOptional(field: HayaiField): boolean {
  return !field.required && !field.primary;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function lowerFirst(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/**
 * Regex pattern for matching model section markers in Prisma schema.
 * Escapes special characters in model name for safe regex matching.
 */
export function createModelSectionPattern(modelName: string): RegExp {
  // Escape special regex characters in start marker (e.g., "//SECTION::MODEL_User")
  const startMarker = MARKERS.modelStart(modelName).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  // Escape special regex characters in end marker (e.g., "//SECTION_END:MODEL_User")
  const endMarker = MARKERS.modelEnd(modelName).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  // Match entire model section between start and end markers
  return new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, "gm");
}

/**
 * Regex pattern for matching model definitions in Prisma schema.
 */
export function createModelDefinitionPattern(modelName: string): RegExp {
  // Matches: model ModelName { ... }
  return new RegExp(`model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\}`, "m");
}

function buildPrismaFieldLines(config: HayaiConfig): string[] {
  const lines: string[] = [];

  if (config.table_name?.length) {
    lines.push(`  @@map("${config.table_name}")`);
  }

  for (const f of config.fields) {
    const prismaType = mapTypeToPrisma(f.type);
    const optional = isOptional(f) ? "?" : "";
    const id = f.primary ? " @id" : "";
    const def = prismaDefaultClause(f.default, f.type, f.primary ?? false);
    const unique = f.unique && !f.primary ? " @unique" : "";
    lines.push(`  ${f.name} ${prismaType}${optional} ${id} ${def} ${unique}`);
  }
  return lines;
}

function buildForeignKeyLines(config: HayaiConfig): string[] {
  const lines: string[] = [];
  const rules = loadRelationRules();
  const onDelete = rules.onDelete || "Cascade";
  const defaultRelationField = rules.defaultRelationField || "Rel";

  // Track relation names to avoid collisions when multiple relations target the same model
  const usedRelNames = new Set<string>();

  for (const f of config.fields) {
    if (!f.relation) continue;
    const [targetModel, targetField] = f.relation.split(".");
    let relName = f.name.endsWith("Id")
      ? f.name.slice(0, -2)
      : lowerFirst(targetModel);

    // Avoid collision when scalar field name equals relation field name
    if (relName === f.name) relName = `${relName}${defaultRelationField}`;

    // Avoid collision when multiple relations to the same model would create duplicate relation field names
    let finalRelName = relName;
    let suffix = 1;
    while (usedRelNames.has(finalRelName)) {
      finalRelName = `${relName}${defaultRelationField}${suffix > 1 ? suffix : ""}`;
      suffix++;
    }
    usedRelNames.add(finalRelName);

    lines.push(
      `  ${finalRelName} ${targetModel} @relation(fields: [${f.name}], references: [${targetField}], onDelete: ${onDelete})`
    );
  }
  return lines;
}

export function buildPrismaModel(config: HayaiConfig): string {
  const modelName = capitalize(config.name);
  const lines: string[] = [];

  lines.push(MARKERS.modelStart(modelName));
  lines.push(`model ${modelName} {`);

  // Fields
  lines.push(...buildPrismaFieldLines(config));

  lines.push("", `  ${MARKERS.foreignKey}`);
  lines.push(...buildForeignKeyLines(config));

  lines.push("", `  ${MARKERS.backStart}`, `  ${MARKERS.backEnd}`, "}");
  lines.push(MARKERS.modelEnd(modelName));

  return lines.join("\n");
}

function ensureSchemaFromTemplate(abs: string) {
  if (existsSync(abs)) return;
  const templatePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "templates",
    "module",
    "prisma.schema.hayai"
  );
  const dir = abs.slice(0, abs.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(templatePath)) {
    let tpl = readTemplateCached(templatePath);
    tpl = tpl.replace("{{dbProvider}}", '"sqlite"').replace("{{}}", "");
    writeFileSync(abs, tpl, "utf8");
  } else {
    const base =
      `generator client {\n  provider = "prisma-client-js"\n}\n\n` +
      `datasource db {\n  provider = "sqlite"\n  url      = env("DATABASE_URL")\n}\n`;
    writeFileSync(abs, base, "utf8");
  }
}

function addBackRelations(schemaAbsPath: string) {
  const projectRoot = resolve(schemaAbsPath, "../..");
  const templatesDir = resolve(projectRoot, TEMPLATES_DIR);
  let backRefs: Record<string, Set<string>> = {};

  // Scan all *.hayai.json in templates directory to determine current back references
  try {
    if (!existsSync(templatesDir)) return; // No templates directory, skip
    const files = readdirSync(templatesDir).filter((f) =>
      f.endsWith(".hayai.json")
    );
    for (const file of files) {
      try {
        const cfg = JSON.parse(
          readFileSync(resolve(templatesDir, file), "utf8")
        );
        const srcModel = capitalize(cfg.name);
        for (const fld of cfg.fields ?? []) {
          if (!fld.relation) continue;
          const target = String(fld.relation).split(".")[0];
          backRefs[target] ??= new Set<string>();
          backRefs[target].add(srcModel);
        }
      } catch { }
    }
  } catch { }

  // Update schema: rebuild BACK_REFERENCE section for every model to ensure references are up to date
  let schema = readFileSync(schemaAbsPath, "utf8");
  let changed = false;

  // Augment backRefs for User based on actual generated schema ownership (userId relations)
  try {
    const allModels = listGeneratedModels(schemaAbsPath);
    for (const modelName of allModels) {
      const regex = createModelDefinitionPattern(modelName);
      const match = schema.match(regex);
      if (!match) continue;
      const body = match[1];
      // Check if model has a userId field (word boundary ensures exact match, not part of another word)
      const hasUserId = /\buserId\b/.test(body);
      // Check if model has a User relation with userId as foreign key
      // Matches: User @relation(fields: [userId])
      const hasUserRel =
        /\bUser\b\s*@relation\(fields:\s*\[\s*userId\s*\]/.test(body);
      if (hasUserId && hasUserRel) {
        backRefs["User"] ??= new Set<string>();
        backRefs["User"].add(modelName);
      }
    }
  } catch { }

  const modelNames = listGeneratedModels(schemaAbsPath);
  for (const targetModelName of modelNames) {
    const sources = Array.from(backRefs[targetModelName] ?? new Set<string>());
    const regex = createModelDefinitionPattern(targetModelName);
    const match = schema.match(regex);
    if (!match) continue;

    const full = match[0];
    let body = match[1];
    const rules = loadRelationRules();
    const backRefSuffix = rules.backRefSuffix || "s";
    const backStart = body.indexOf(MARKERS.backStart);
    const backEnd = body.indexOf(MARKERS.backEnd);
    const backLines = sources
      .map((sourceModelName) => `  ${lowerFirst(sourceModelName)}${backRefSuffix} ${sourceModelName}[]`)
      .join("\n");

    if (backStart === -1 || backEnd === -1 || backEnd < backStart) {
      // Add new section
      // Match closing brace at end of string ($ = end of line/string)
      const enhanced = full.replace(
        /\}$/,
        `${backLines
          ? `  ${MARKERS.backStart}\n${backLines}\n  ${MARKERS.backEnd}\n`
          : `  ${MARKERS.backStart}\n  ${MARKERS.backEnd}\n`
        }}`
      );
      schema = schema.replace(full, enhanced);
      changed = true;
    } else {
      // Replace inside markers, clearing when no sources
      const pre = body.slice(0, backStart + MARKERS.backStart.length);
      const post = body.slice(backEnd);
      const newBody = `${pre}\n${backLines}\n${post}`;
      schema = schema.replace(full, full.replace(body, newBody));
      changed = true;
    }
  }

  if (changed) writeFileSync(schemaAbsPath, normalizeModels(schema), "utf8");
}

export function listGeneratedModels(schemaPath: string): string[] {
  const abs = resolve(schemaPath);
  if (!existsSync(abs)) return [];
  const schema = readFileSync(abs, "utf8");
  // Match any model start marker and extract model name
  // Matches: //SECTION::MODEL_ModelName
  const matches = Array.from(schema.matchAll(/\/\/SECTION::MODEL_(\w+)/g));
  return matches.map((m) => m[1]);
}

function overwriteModelSegmentsLocal(
  schema: string,
  config: HayaiConfig
): string | null {
  const modelName = capitalize(config.name);
  const newFields = buildPrismaFieldLines(config);
  const newForeignKeys = buildForeignKeyLines(config);
  return overwriteModelSegments(schema, modelName, newFields, newForeignKeys);
}

export function upsertModel(
  schemaPath: string,
  config: HayaiConfig,
  overwrite: boolean
) {
  const abs = resolve(schemaPath);
  ensureSchemaFromTemplate(abs);
  let schema = readFileSync(abs, "utf8");
  const modelName = capitalize(config.name);
  const modelBlock = buildPrismaModel(config);
  // Check if model section already exists in schema
  // Matches: //SECTION::MODEL_ModelName (where ModelName is escaped)
  const exists = new RegExp(
    `\/\/SECTION::MODEL_${modelName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}`
  ).test(schema);

  if (!exists) {
    schema = `${schema.trim()}\n\n${modelBlock}\n`;
    writeFileSync(abs, normalizeModels(schema), "utf8");
    addBackRelations(abs);
    return { action: "appended", modelBlock };
  }

  if (!overwrite) return { action: "skipped", modelBlock };

  // Structured overwrite of fields and FK sections
  const structured = overwriteModelSegmentsLocal(schema, config);
  if (structured) {
    writeFileSync(abs, structured, "utf8");
    addBackRelations(abs);
    return { action: "replaced", modelBlock };
  }

  // Fallback: full block replace
  const replaced = replaceModelBlock(schema, modelName, modelBlock);
  if (!replaced) return { action: "skipped", modelBlock };
  writeFileSync(abs, normalizeModels(replaced), "utf8");
  addBackRelations(abs);
  return { action: "replaced", modelBlock };
}

export function removeModel(schemaPath: string, modelNameRaw: string): boolean {
  const abs = resolve(schemaPath);
  if (!existsSync(abs)) return false;
  let schema = readFileSync(abs, "utf8");
  const modelName = capitalize(modelNameRaw);
  const pattern = createModelSectionPattern(modelName);
  if (!pattern.test(schema)) return false;
  schema = schema.replace(pattern, "");
  writeFileSync(abs, normalizeModels(schema), "utf8");
  addBackRelations(abs);
  return true;
}
