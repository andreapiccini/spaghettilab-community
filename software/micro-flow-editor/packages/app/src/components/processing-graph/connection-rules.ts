import {
  catalogPortsCompatible,
  type ProcessingCatalogEntry,
} from "@spaghettilab/processing-block-catalog";

/**
 * Connection rules for the Device Processing Graph canvas.
 * - No self-loops
 * - When both ends declare catalog ports, output kinds must be compatible
 *   with input kinds (`activation` is a jolly that matches any input)
 */
export function isValidProcessingConnection(
  connection: {
    readonly source?: string | null;
    readonly target?: string | null;
    readonly sourceHandle?: string | null;
    readonly targetHandle?: string | null;
  },
  resolveEntry?: (nodeId: string) => ProcessingCatalogEntry | undefined,
): boolean {
  if (!connection.source || !connection.target) return false;
  if (connection.source === connection.target) return false;
  if (!resolveEntry) return true;

  const sourceEntry = resolveEntry(connection.source);
  const targetEntry = resolveEntry(connection.target);
  if (!sourceEntry && !targetEntry) return true;

  return catalogPortsCompatible(
    sourceEntry?.outputs,
    targetEntry?.inputs,
    connection.sourceHandle,
    connection.targetHandle,
  );
}
