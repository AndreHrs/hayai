export interface HayaiField {
  name: string;
  type: string;
  required?: boolean;
  primary?: boolean;
  default?: string;
  relation?: string;
  store_hashed?: boolean;
  hide_from_get?: boolean;
  forbid_update?: boolean;
  validator?: string[];
  unique?: boolean;
}

export interface HayaiRoutesConfigItem {
  endpoint: string;
  method: string;
  auth_required?: boolean;
  check_ownership?: boolean;
  admin_only?: boolean;
}

/**
 * Main configuration interface for a Hayai module.
 * This is the structure expected in .hayai.json files.
 */
export interface HayaiConfig {
  name: string; // PascalCase e.g. Post
  table_name?: string; // prisma table name e.g. posts
  fields: HayaiField[];
  routes?: Record<string, HayaiRoutesConfigItem>;
}

/**
 * Template rendering context.
 * A record of string key-value pairs used for template variable substitution.
 */
export type RenderContext = Record<string, string>;

