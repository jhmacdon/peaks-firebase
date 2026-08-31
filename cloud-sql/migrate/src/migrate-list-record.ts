import {
  normalizeStoredListCompletionTarget,
  readImportedListCompletionTarget,
} from "./list-completion-target";

export interface ListMigrationClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
  release(): void;
}

export interface ListMigrationPool {
  connect(): Promise<ListMigrationClient>;
}

interface PreparedFirestoreList {
  destinationIds: string[];
  completionTarget: number | null;
  name: string;
  description: string | null;
  owner: string;
}

/** Validate a Firestore list before opening a database transaction. */
export function prepareFirestoreList(
  id: string,
  value: Record<string, unknown>
): PreparedFirestoreList {
  if (!Array.isArray(value.destinations)) {
    throw new Error(`List ${id} destinations must be an array`);
  }

  const destinationIds: string[] = [];
  const seen = new Set<string>();
  for (const destinationId of value.destinations) {
    if (typeof destinationId !== "string" || destinationId.length === 0) {
      throw new Error(`List ${id} has an invalid destination ID`);
    }
    if (seen.has(destinationId)) {
      throw new Error(`List ${id} repeats destination ${destinationId}`);
    }
    seen.add(destinationId);
    destinationIds.push(destinationId);
  }

  const rawCompletionTarget = readImportedListCompletionTarget(value);
  const completionTarget = normalizeStoredListCompletionTarget(
    rawCompletionTarget,
    destinationIds.length
  );
  if (rawCompletionTarget != null && completionTarget == null) {
    const allowed = destinationIds.length > 0
      ? `a whole number between 1 and ${destinationIds.length}`
      : "null for an empty list";
    throw new Error(`List ${id} completion target must be ${allowed}`);
  }

  return {
    destinationIds,
    completionTarget,
    name: typeof value.name === "string" && value.name.length > 0
      ? value.name
      : "Unnamed",
    description: typeof value.description === "string" && value.description.length > 0
      ? value.description
      : null,
    owner: typeof value.owner === "string" && value.owner.length > 0
      ? value.owner
      : "peaks",
  };
}

/** Reconcile one list and its complete membership set as one transaction. */
export async function reconcileFirestoreList(
  pool: ListMigrationPool,
  id: string,
  value: Record<string, unknown>
): Promise<void> {
  const list = prepareFirestoreList(id, value);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO lists (id, name, description, owner, completion_target)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         completion_target = EXCLUDED.completion_target,
         updated_at = now()`,
      [id, list.name, list.description, list.owner, list.completionTarget]
    );

    // The Firestore array is the full roster. NOT (= ANY(empty array)) is true,
    // so an explicit empty array safely removes every membership for this list.
    await client.query(
      `DELETE FROM list_destinations
       WHERE list_id = $1
         AND NOT (destination_id = ANY($2::text[]))`,
      [id, list.destinationIds]
    );

    for (const [ordinal, destinationId] of list.destinationIds.entries()) {
      await client.query(
        `INSERT INTO list_destinations (list_id, destination_id, ordinal)
         VALUES ($1, $2, $3)
         ON CONFLICT (list_id, destination_id) DO UPDATE SET ordinal = EXCLUDED.ordinal`,
        [id, destinationId, ordinal]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the original migration failure.
    }
    throw error;
  } finally {
    client.release();
  }
}
