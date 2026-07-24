import { prisma, type Prisma } from "@opennpc/db";
import type { LookupMapping, MappingDefinition } from "@opennpc/mapping";
import type { MappingDraft } from "@opennpc/mapping";

/**
 * The `mapping_definition` DB row is the persisted, editable form of a mapping.
 * These converters bridge it to the in-memory `MappingDefinition` the transform
 * engine consumes. The non-scalar bits (lookups/constants/reconcile) live in the
 * row's `options` JSON; function-valued `filter`s are not persisted (see schema).
 */

interface MappingOptions {
  lookups?: Record<string, LookupMapping>;
  constants?: Record<string, unknown>;
  reconcile?: { amountField: string };
}

interface MappingRow {
  object: string;
  target: string | null;
  fieldMap: unknown;
  valueMap: unknown;
  options: unknown;
}

/** Row -> in-memory MappingDefinition (null when the row has no target yet). */
export function rowToMappingDefinition(row: MappingRow): MappingDefinition | null {
  if (!row.target) return null;
  const options = (row.options ?? {}) as MappingOptions;
  return {
    source: row.object,
    target: row.target,
    fieldMap: (row.fieldMap ?? {}) as Record<string, string>,
    valueMap: (row.valueMap ?? {}) as Record<string, Record<string, string>>,
    lookups: options.lookups,
    constants: options.constants,
    reconcile: options.reconcile,
  };
}

/** MappingDraft -> `mapping_definition` createMany input row. */
export function draftToRow(
  projectId: string,
  draft: MappingDraft,
): Prisma.MappingDefinitionCreateManyInput {
  return {
    projectId,
    object: draft.source,
    target: draft.target,
    fieldMap: (draft.fieldMap ?? {}) as Prisma.InputJsonValue,
    valueMap: (draft.valueMap ?? {}) as Prisma.InputJsonValue,
    options: {
      lookups: draft.lookups,
      constants: draft.constants,
      reconcile: draft.reconcile,
    } as unknown as Prisma.InputJsonValue,
    enabled: draft.enabledByDefault,
    autoDrafted: true,
    confidence: draft.confidence,
  };
}

/**
 * Load a project's ENABLED mappings as a `{ sourceObject: MappingDefinition }`
 * record — the drop-in replacement for the old hardcoded DEFAULT_MAPPINGS that the
 * pipeline (transform/prepare-target/validate) keys on. Disabled and target-less
 * rows are skipped so unreviewed drafts never drive a real migration.
 */
export async function loadProjectMappings(
  projectId: string,
): Promise<Record<string, MappingDefinition>> {
  const rows = await prisma.mappingDefinition.findMany({
    where: { projectId, enabled: true, target: { not: null } },
    select: { object: true, target: true, fieldMap: true, valueMap: true, options: true },
  });
  const out: Record<string, MappingDefinition> = {};
  for (const row of rows) {
    const def = rowToMappingDefinition(row);
    if (def) out[def.source] = def;
  }
  return out;
}
