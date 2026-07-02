import type { Connection } from "jsforce";

/**
 * Bulk API 2.0 query (the Extract engine). Bulk 2.0 automatically chunks large
 * result sets server-side, so no manual PK chunking is required. Results are
 * streamed and handed to `onBatch` in chunks so large objects don't have to be
 * held entirely in memory. See docs/07-salesforce-integration.md §2.
 */

/** Minimal shape of the jsforce Bulk 2.0 record stream we rely on. */
interface RecordEventStream {
  on(event: "record", cb: (rec: Record<string, unknown>) => void): this;
  on(event: "error", cb: (err: Error) => void): this;
  on(event: "end", cb: () => void): this;
  pause?(): void;
  resume?(): void;
}

export interface BulkQueryOptions {
  soql: string;
  batchSize?: number;
  onBatch: (records: Record<string, unknown>[]) => Promise<void>;
  onProgress?: (total: number) => Promise<void> | void;
}

/**
 * Run a Bulk API 2.0 query and stream results to `onBatch` in batches.
 * Returns the total number of records processed.
 */
export async function bulkQuery(conn: Connection, opts: BulkQueryOptions): Promise<number> {
  const batchSize = opts.batchSize ?? 10000;
  // bulk2.query() returns a Promise<Parsable> (the record stream), so it must be
  // awaited before attaching event listeners.
  const stream = (await conn.bulk2.query(opts.soql)) as unknown as RecordEventStream;

  let buffer: Record<string, unknown>[] = [];
  let total = 0;
  // Serialize DB writes so batches are flushed in order and errors propagate.
  let chain: Promise<void> = Promise.resolve();

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    await opts.onBatch(batch);
    total += batch.length;
    await opts.onProgress?.(total);
  };

  return await new Promise<number>((resolve, reject) => {
    stream.on("record", (rec) => {
      buffer.push(rec);
      if (buffer.length >= batchSize) {
        stream.pause?.();
        chain = chain
          .then(flush)
          .then(() => stream.resume?.())
          .catch(reject);
      }
    });
    stream.on("error", (err) => reject(err));
    stream.on("end", () => {
      chain
        .then(flush)
        .then(() => resolve(total))
        .catch(reject);
    });
  });
}
