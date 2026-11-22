import type { Store } from './runtime/store.ts';
import { attempt } from './runtime/step.ts';
import { transaction } from '../adapters/migrate.ts';
import { post } from '../adapters/erpSim.ts';
import type { DatabaseSync } from 'node:sqlite';
import type { IdGenerator } from '../adapters/clock.ts';
import type { RequestMeta } from '../domain/types.ts';
import { conflict } from './errors.ts';
import type { ReadTools } from '../evidence/tools.ts';
import { freezeSnapshot } from './approvals.ts';
import { summary } from '../report/summary.ts';
import { policies } from '../rules/registry.ts';
export function submit(
  store: Store,
  erp: DatabaseSync,
  tools: ReadTools,
  ids: IdGenerator,
  id: string,
  meta: RequestMeta,
) {
  const { db } = store;
  const intent = db
    .prepare(
      `SELECT o.*, a.snapshot_hash FROM outbox o JOIN approvals a
 ON o.approval_id=a.id AND o.run_id=a.run_id WHERE o.run_id=? AND a.status='APPROVED' AND o.status='PENDING'`,
    )
    .get(id);
  const result = store.view(id)?.result;
  const snapshot = result?.approvalSnapshot;
  if (!intent || !result || result.status !== 'SUBMITTING' || !snapshot)
    return conflict('No approved submit intent');
  const { hash, ...fields } = snapshot;
  if (
    hash !== intent.snapshot_hash ||
    freezeSnapshot(fields).hash !== hash ||
    fields.action !== intent.finance_action
  )
    return conflict('Snapshot mismatch');
  const vendor = attempt(store, id, meta, 'get_vendor_record', () =>
    tools.vendor(snapshot.vendorId),
  );
  const policy = policies[4];
  const authority = attempt(store, id, meta, 'retrieve_finance_documents', () =>
    tools.retrieve(
      { query: policy.query, topK: 3, filters: { trust: 'authority' } },
      store.clock.now().toISOString().slice(0, 10),
    ),
  );
  store.event(id, meta, 'RETRIEVAL', {
    query: policy.query,
    chunks: authority.map(({ chunkId, version }) => ({ chunkId, version })),
  });
  if (
    vendor.status !== 'ACTIVE' ||
    vendor.bankAccountVersion !== snapshot.bankAccountVersion ||
    !authority.some(
      (c) => c.citation === policy.ref && c.version === snapshot.policyVersions[c.documentId],
    )
  )
    return conflict('Evidence changed');
  const key = String(intent.idempotency_key);
  if (
    !db
      .prepare("UPDATE outbox SET status='SENDING' WHERE idempotency_key=? AND status='PENDING'")
      .run(key).changes
  )
    return conflict('Already sending');
  const { vendorId, invoiceRef, amount, currency } = snapshot;
  const receipt = attempt(store, id, meta, 'submit_finance_decision', () =>
    post(
      erp,
      {
        runId: id,
        financeAction: snapshot.action,
        approvalIds: [intent.approval_id],
        snapshotHash: hash,
        idempotencyKey: key,
        payload: { vendorId, invoiceRef, amount, currency },
      },
      store.clock,
      ids,
    ),
  );
  if (receipt.status !== 'ACCEPTED' && receipt.status !== 'REPLAYED')
    return conflict(receipt.status);
  transaction(db, () => {
    db.prepare("UPDATE outbox SET status='SENT', posting_ref=? WHERE idempotency_key=?").run(
      receipt.postingRef,
      key,
    );
    result.actionsTaken.push({ action: snapshot.action, postingRef: receipt.postingRef });
    result.status = 'COMPLETED';
    result.decisionSummary = summary(result.status, true, [], result.unknowns, snapshot.action);
    result.proposal.nextAction = { owner: 'Accounts Payable', action: 'Posting complete' };
    store.save(result, 'submit');
    store.event(id, meta, 'STEP_COMPLETED', { name: 'submit', postingRef: receipt.postingRef });
  });
}
