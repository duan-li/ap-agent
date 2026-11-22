import type { DatabaseSync } from 'node:sqlite';
import { toolSchemas } from '../domain/types.ts';
import type { Clock, IdGenerator } from './clock.ts';
import { normaliseInvoice } from './toolBackends.ts';
import { transaction } from './migrate.ts';
export function post(db: DatabaseSync, input: unknown, clock: Clock, ids: IdGenerator) {
  const cmd = toolSchemas.submit_finance_decision.input.parse(input);
  return transaction(db, () => {
    const prior = db
      .prepare('SELECT posting_ref,received_at FROM erp_postings WHERE idempotency_key=?')
      .get(cmd.idempotencyKey);
    const schema = toolSchemas.submit_finance_decision.output;
    if (prior)
      return schema.parse({
        status: 'REPLAYED',
        postingRef: prior.posting_ref,
        receivedAt: prior.received_at,
      });
    const postingRef = ids.next('erp'),
      receivedAt = clock.now().toISOString();
    const p = cmd.payload;
    const inserted = db
      .prepare(
        'INSERT INTO erp_postings VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(vendor_id,invoice_no_normalised) DO NOTHING',
      )
      .run(
        cmd.idempotencyKey,
        p.vendorId,
        normaliseInvoice(p.invoiceRef),
        cmd.financeAction,
        p.amount,
        p.currency,
        postingRef,
        receivedAt,
      );
    return schema.parse(
      inserted.changes
        ? { status: 'ACCEPTED', postingRef, receivedAt }
        : { status: 'DUPLICATE_INVOICE', receivedAt },
    );
  });
}

export function lookupPosting(db: DatabaseSync, key: string, unavailable = false): string | null {
  if (unavailable) throw new Error('ERP lookup unavailable');
  const row = db.prepare('SELECT posting_ref FROM erp_postings WHERE idempotency_key=?').get(key);
  return row ? String(row.posting_ref) : null;
}
