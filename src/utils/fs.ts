import { writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from "fs";
import { dirname, resolve, join } from "path";
import { log } from "./log";

/**
 * Ensures a directory exists, creating it recursively if needed.
 */
export function ensureDir(p: string): void {
  if (!existsSync(p)) {
    mkdirSync(p, { recursive: true });
  }
}

/**
 * Copies a directory recursively from src to dest.
 * Does not overwrite existing files in dest.
 */
export function copyDir(src: string, dest: string): void {
  if (!existsSync(src)) return;
  ensureDir(dest);
  
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    const st = statSync(s);
    
    if (st.isDirectory()) {
      copyDir(s, d);
    } else {
      ensureDir(dirname(d));
      // Do not overwrite existing files to be safe
      if (!existsSync(d)) {
        copyFileSync(s, d);
      }
    }
  }
}

/**
 * Safely writes content to a file, creating parent directories if needed.
 * @param dest - Destination file path
 * @param content - Content to write
 * @param overwrite - Whether to overwrite if file exists (default: true)
 * @returns true if written, false if skipped
 */
export function safeWrite(dest: string, content: string, overwrite: boolean = true): boolean {
  const absPath = resolve(dest);
  const dir = dirname(absPath);
  
  if (!overwrite && existsSync(absPath)) {
    return false;
  }
  
  ensureDir(dir);
  writeFileSync(absPath, content, "utf8");
  return true;
}

export async function writeGeneratedFile(path: string, content: string): Promise<void> {
  const absPath = resolve(path);
  const dir = dirname(absPath);
  
  ensureDir(dir);
  
  await Bun.write(absPath, content);
  log.success(`Generated ${path}`);
}

export function writeGeneratedFileSync(path: string, content: string): void {
  const absPath = resolve(path);
  const dir = dirname(absPath);
  
  ensureDir(dir);
  
  writeFileSync(absPath, content, "utf8");
  log.success(`Generated ${path}`);
}

