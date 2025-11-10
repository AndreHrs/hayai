import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { log } from "./log";

/**
 * Global template cache to avoid repeated file system access.
 */
const cache = new Map<string, string>();

/**
 * Reads a template file with caching.
 * Templates are loaded once and cached in memory for subsequent access.
 * 
 * @param path - Absolute or relative path to the template file
 * @returns The template content as a string, or empty string if file not found
 */
export function readTemplateCached(path: string): string {
  const absPath = resolve(path);
  
  if (cache.has(absPath)) {
    return cache.get(absPath)!;
  }
  
  if (!existsSync(absPath)) {
    log.error(`Template not found: ${absPath}`);
    return "";
  }
  
  try {
    const content = readFileSync(absPath, "utf8");
    cache.set(absPath, content);
    return content;
  } catch (err) {
    log.error(`Failed to read template ${absPath}: ${err}`);
    return "";
  }
}

/**
 * Clears the template cache.
 * Useful for testing or when templates are updated during development.
 */
export function clearTemplateCache(): void {
  cache.clear();
}

/**
 * Preloads templates from a list of paths.
 * Useful for eager loading during initialization.
 * 
 * @param paths - Array of template paths to preload
 */
export function preloadTemplates(paths: string[]): void {
  for (const path of paths) {
    readTemplateCached(path);
  }
}

