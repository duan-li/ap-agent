import type { Store } from './runtime/store.ts';
import { attempt } from './runtime/step.ts';
import { post, lookupPosting } from '../adapters/erpSim.ts';
import type { DatabaseSync } from 'node:sqlite';
import type { IdGenerator } from '../adapters/clock.ts';
import type { RequestMeta } from '../domain/types.ts';
import { BudgetExceeded, conflict } from './errors.ts';
import { DeadlineReached, ToolFailure, checkDeadline, type ReadTools } from '../evidence/tools.ts';
import { freezeSnapshot, authorityMatches, invalidate } from './approvals.ts';
import { summary } from '../report/summary.ts';
export async function submit(
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
      `SELECT o.*, a.snapshot_hash,a.status AS approval_status FROM outbox o JOIN approvals a
 ON o.approval_id=a.id AND o.run_id=a.run_id WHERE o.run_id=? AND o.status IN ('PENDING','SENDING')`,
    )
    .get(id);
  const result = store.view(id)?.result;
  const snapshot = result?.approvalSnapshot;
  if (!intent || !result || result.status !== 'SUBMITTING' || !snapshot)
    return conflict('No approved submit intent');
  const key = String(intent.idempotency_key);

  const recovering = intent.status === 'SENDING';
  const vendorRecord = () => tools.vendor(snapshot.vendorId);
  if (recovering) {
    let postingRef;
    try {
      postingRef = lookupPosting(erp, key, store.simulation(id).erpLookupFails);
    } catch {
      store.write(() => {
        store.event(id, meta, 'ERP_LOOKUP', { idempotencyKey: key, outcome: 'ERROR' });
        db.prepare("UPDATE outbox SET status='RECONCILE_REQUIRED' WHERE idempotency_key=?").run(
          key,
        );
        result.status = 'COMPLETED';
        result.proposal = {
          outcome: 'HOLD_FOR_INFORMATION',
          nextAction: {
            owner: 'Accounts Payable',
            action: 'Reconcile the unknown ERP posting before taking further action',
          },
        };
        result.unknowns.push('ERP posting status');
        result.decisionSummary = summary(result.status, false, [], result.unknowns, 'NONE');
        result.decisionSummary.financeActionTaken = 'Unknown pending ERP reconciliation';
        store.event(id, meta, 'RECONCILE_REQUIRED', { idempotencyKey: key });
        store.save(result, 'reconcile_submit');
      });
      return;
    }
    store.event(id, meta, 'ERP_LOOKUP', {
      idempotencyKey: key,
      outcome: postingRef ? 'FOUND' : 'ABSENT',
    });
    if (postingRef) {
      store.write(() => {
        complete(postingRef);
        store.event(id, meta, 'OUTBOX_RECONCILED', { postingRef, idempotencyKey: key });
      });
      // The receipt is durable before this best-effort audit of later changes.
      // A missing read budget cannot invalidate a posting.
      try {
        const vendor = await attempt(store, id, meta, 'get_vendor_record', vendorRecord);
        if (vendor.status !== 'ACTIVE' || vendor.bankAccountVersion !== snapshot.bankAccountVersion)
          store.event(id, meta, 'VENDOR_CHANGED_AFTER_POSTING', {
            vendorId: vendor.vendorId,
            status: vendor.status,
            bankAccountVersion: vendor.bankAccountVersion,
          });
      } catch (error) {
        if (!(
          error instanceof BudgetExceeded ||
          error instanceof DeadlineReached ||
          error instanceof ToolFailure
        ))
          throw error;
        store.event(id, meta, 'VENDOR_RECHECK_UNAVAILABLE', { postingRef });
      }
      return;
    }
    store.write(() =>
      db.prepare("UPDATE outbox SET status='PENDING' WHERE idempotency_key=?").run(key),
    );
  }
  const { hash, ...fields } = snapshot;
  if (
    intent.approval_status !== 'APPROVED' ||
    hash !== intent.snapshot_hash ||
    freezeSnapshot(fields).hash !== hash ||
    fields.action !== intent.finance_action
  ) {
    store.write(() =>
      invalidate(
        store,
        id,
        meta,
        result,
        String(intent.approval_id),
        'AUTHORITY_GAP',
        'Approval no longer matches the submit intent',
      ),
    );
    return;
  }
  store.ensure(id, 'steps');
  const vendor = await attempt(store, id, meta, 'get_vendor_record', vendorRecord);
  const authorityValid = await authorityMatches(store, tools, id, meta, snapshot);
  const stale =
    vendor.status !== 'ACTIVE'
      ? (['VENDOR_BLOCK', vendor.status] as const)
      : vendor.bankAccountVersion !== snapshot.bankAccountVersion
        ? (['BANK_CHANGE', 'Bank account version changed'] as const)
        : !authorityValid
          ? (['AUTHORITY_GAP', 'Authority policy changed'] as const)
          : null;
  if (stale) {
    store.write(() =>
      invalidate(store, id, meta, result, String(intent.approval_id), stale[0], stale[1]),
    );
    return;
  }
  // Check the remaining budget and deadline before recording the send intent.
  store.ensure(id, 'tool_calls');
  checkDeadline({ clock: store.clock, deadline: meta.deadline, signal: meta.signal });
  store.write(() => {
    store.spend(id, 'steps');
    if (
      !db
        .prepare("UPDATE outbox SET status='SENDING' WHERE idempotency_key=? AND status='PENDING'")
        .run(key).changes
    )
      return conflict('Already sending');
  });
  // A process crash beyond this point requires lookup by the original key.
  store.event(id, meta, 'OUTBOX_SENDING', { idempotencyKey: key });
  store.crash(id, 'crashAfterOutboxSending');
  const { vendorId, invoiceRef, amount, currency } = snapshot;
  const receipt = await attempt(store, id, meta, 'submit_finance_decision', () =>
    store.write(() =>
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
    ),
  );
  if (receipt.status !== 'ACCEPTED' && receipt.status !== 'REPLAYED')
    return conflict(receipt.status);
  store.crash(id, 'crashAfterErpPost');
  store.write(() => complete(receipt.postingRef));
  store.crash(id, 'crashAfterStep', 'submit');

  function complete(postingRef: string) {
    if (!result || !intent) return conflict('Missing submit intent');
    const action = intent.finance_action === 'POST' ? 'POST' : 'REJECT_INVOICE';
    db.prepare("UPDATE outbox SET status='SENT', posting_ref=? WHERE idempotency_key=?").run(
      postingRef,
      key,
    );
    result.actionsTaken.push({ action, postingRef });
    result.status = 'COMPLETED';
    result.decisionSummary = summary(result.status, true, [], result.unknowns, action);
    result.proposal.nextAction = {
      owner: 'Accounts Payable',
      action: action === 'POST' ? 'Posting complete' : 'New invoice submission rejected',
    };
    store.save(result, 'submit');
    store.event(id, meta, 'STEP_COMPLETED', { name: 'submit', postingRef });
  }
}
