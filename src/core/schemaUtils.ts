import { MARKERS } from "../constants/markers";

/**
 * Normalizes model sections in a Prisma schema string.
 * Ensures every model section has proper start and end markers.
 *
 * @param schema - The Prisma schema content as a string
 * @returns Normalized schema with cleaned up markers
 */
export function normalizeModels(schema: string): string {
  // Ensure every model section ends cleanly
  schema = schema.replace(
    /(\/\/SECTION::MODEL_(\w+)[\s\S]*?)(?=\/\/SECTION::MODEL_|$)/g,
    (block) => {
      const match = block.match(/\/\/SECTION::MODEL_(\w+)/);
      const name = match ? match[1] : null;
      if (!name) return block;
      const endMarker = MARKERS.modelEnd(name);
      block = block.replace(
        new RegExp(
          `(${endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})+`,
          "g"
        ),
        endMarker
      );
      if (!block.includes(endMarker)) block += `\n${endMarker}`;
      return block;
    }
  );
  return schema.replace(/\n{3,}/g, "\n\n");
}

/**
 * Replaces a model block in a schema string.
 *
 * @param schema - The full schema content
 * @param modelName - The name of the model to replace
 * @param newBlock - The new model block content
 * @returns Updated schema string, or null if model not found
 */
export function replaceModelBlock(
  schema: string,
  modelName: string,
  newBlock: string
): string | null {
  const safeName = modelName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  const startMarker = MARKERS.modelStart(modelName);
  const endMarker = MARKERS.modelEnd(modelName);
  const pattern = new RegExp(
    `${startMarker.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    )}[\\s\\S]*?${endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "gm"
  );

  if (!pattern.test(schema)) return null;
  const cleaned = newBlock.replace(/\n{3,}/g, "\n\n");
  return schema.replace(pattern, cleaned + "\n");
}

/**
 * Overwrites specific segments of a model block (fields, foreign keys, back references).
 *
 * @param schema - The full schema content
 * @param modelName - The name of the model
 * @param newFields - New field lines to insert
 * @param newForeignKeys - New foreign key lines to insert
 * @returns Updated schema string, or null if model not found
 */
export function overwriteModelSegments(
  schema: string,
  modelName: string,
  newFields: string[],
  newForeignKeys: string[]
): string | null {
  const startMarker = MARKERS.modelStart(modelName);
  const endMarker = MARKERS.modelEnd(modelName);
  const startIdx = schema.indexOf(startMarker);
  if (startIdx === -1) return null;
  const endIdx = schema.indexOf(endMarker, startIdx);
  if (endIdx === -1) return null;
  const block = schema.slice(startIdx, endIdx + endMarker.length);

  const fkMarker = MARKERS.foreignKey;
  const backStartMarker = MARKERS.backStart;

  const modelHeaderMatch = block.match(
    new RegExp(
      `^${startMarker.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      )}[\\s\\S]*?model\\s+${modelName}\\s*\\{`
    )
  );
  if (!modelHeaderMatch) return null;
  let beforeFields = modelHeaderMatch[0];
  if (!beforeFields.endsWith("\n")) beforeFields += "\n";
  const headerEnd = beforeFields.length;

  const fkIdx = block.indexOf(fkMarker);
  const backIdx = block.indexOf(backStartMarker);
  if (fkIdx === -1 || backIdx === -1 || backIdx < fkIdx) return null;

  const afterFieldsToFk = block.slice(headerEnd, fkIdx);
  const fromFk = block.slice(fkIdx); // from FK section to end

  // Rebuild fields region
  const newFieldLines = newFields.length
    ? `${newFields.join("\n")}\n\n`
    : "\n";

  // Rebuild FK region up to BACK_REFERENCE marker
  const backSectionIdx = fromFk.indexOf(backStartMarker);
  const fkHeader = fromFk.slice(0, fromFk.indexOf("\n", 0) + 1);
  const newFkBody = newForeignKeys.join("\n");
  const fromBack = fromFk.slice(backSectionIdx); // keep backref section as-is

  const rebuiltBlock = [
    beforeFields,
    newFieldLines,
    fkHeader,
    newFkBody ? newFkBody + "\n" : "",
    fromBack,
  ].join("");

  const newSchema =
    schema.slice(0, startIdx) +
    rebuiltBlock +
    schema.slice(endIdx + endMarker.length);
  return normalizeModels(newSchema);
}

/**
 * Extracts the body of a model from a schema string.
 *
 * @param schema - The full schema content
 * @param modelName - The name of the model
 * @returns The model body (content between model { and }), or null if not found
 */
export function extractModelBody(
  schema: string,
  modelName: string
): string | null {
  const pattern = new RegExp(
    `model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\}`,
    "m"
  );
  const match = schema.match(pattern);
  return match ? match[1] : null;
}
