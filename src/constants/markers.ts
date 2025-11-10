/**
 * Constants for Prisma schema section markers.
 * These markers are used to identify and manipulate sections in generated Prisma schemas.
 */
export const MARKERS = {
  /**
   * Start marker for a model section.
   * @param modelName - The name of the model (e.g., "User", "Post")
   */
  modelStart: (modelName: string) => `//SECTION::MODEL_${modelName}`,

  /**
   * End marker for a model section.
   * @param modelName - The name of the model (e.g., "User", "Post")
   */
  modelEnd: (modelName: string) => `//SECTION_END:MODEL_${modelName}`,

  /**
   * Marker for the foreign keys section within a model.
   */
  foreignKey: "//SECTION::FOREIGN_KEYS",

  /**
   * Start marker for back reference section within a model.
   */
  backStart: "//SECTION::BACK_REFERENCE",

  /**
   * End marker for back reference section within a model.
   */
  backEnd: "//SECTION_END:BACK_REFERENCE",

  /**
   * Marker for import routes section in app index.
   */
  importRoutes: "//SECTION::IMPORT_ROUTES",

  /**
   * Marker for API routes section in app index.
   */
  apiRoutes: "// SECTION::API_ROUTES",
} as const;
