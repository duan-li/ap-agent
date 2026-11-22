import { reviewDate } from '../rules/exceptions.ts';
import { policies } from '../rules/registry.ts';
import { summary } from '../report/summary.ts';
import type { Store } from './runtime/store.ts';
import { attempt } from './runtime/step.ts';
import type { ReadTools } from '../evidence/tools.ts';
import type { RequestMeta } from '../domain/types.ts';
import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import type { backends } from '../adapters/toolBackends.ts';
import type { Review } from '../domain/types.ts';
export function authorised(
  register: ReturnType<typeof backends>['register'],
  actor: string,
  role: string,
  amount: string,
  date: string,
) {
  const person = register.approvers.find((p) => p.userId === actor);
  const eligible =
    register.effectiveFrom <= date &&
    !!person &&
    person.role === role &&
    new Decimal(person.limitAud).gte(amount);
  return eligible
    ? { role: person.role, limitAud: person.limitAud, registerVersion: register.registerVersion }
    : null;
}
type Snapshot = NonNullable<Review['approvalSnapshot']>;
export function freezeSnapshot(fields: Omit<Snapshot, 'hash'>): Snapshot {
  const entries = Object.entries({
    ...fields,
    policyVersions: Object.entries(fields.policyVersions).sort(),
  }).sort();
  return {
    ...fields,
    hash: 'sha256:' + createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
  };
}
export async function authorityMatches(
  store: Store,
  tools: ReadTools,
  id: string,
  meta: RequestMeta,
  snapshot: Snapshot,
) {
  const policy = policies[4];
  const asOf = store.clock.now().toISOString().slice(0, 10);
  const authority = await attempt(store, id, meta, 'retrieve_finance_documents', () =>
    tools.retrieve({ query: policy.query, topK: 3, filters: { trust: 'authority' } }, asOf),
  );
  store.event(id, meta, 'RETRIEVAL', {
    query: policy.query,
    asOf,
    chunks: authority.map(({ chunkId, version }) => ({ chunkId, version })),
  });
  return authority.some(
    (c) => c.citation === policy.ref && c.version === snapshot.policyVersions[c.documentId],
  );
}

export function invalidate(
  store: Store,
  id: string,
  meta: RequestMeta,
  result: Review,
  approvalId: string,
  code: 'VENDOR_BLOCK' | 'BANK_CHANGE' | 'AUTHORITY_GAP',
  observed: string,
) {
  store.db
    .prepare("UPDATE approvals SET status='INVALIDATED' WHERE run_id=? AND id=?")
    .run(id, approvalId);
  const event = store.event(id, meta, 'APPROVAL_INVALIDATED', { approvalId, code, observed });
  const cancelled = store.db
    .prepare("UPDATE outbox SET status='CANCELLED' WHERE run_id=? AND status='PENDING'")
    .run(id);
  if (cancelled.changes) store.event(id, meta, 'OUTBOX_CANCELLED', { approvalId });
  const owner = code === 'BANK_CHANGE' ? 'Financial Control' : 'Accounts Payable';
  result.status = 'COMPLETED';
  result.proposal = {
    outcome: code === 'BANK_CHANGE' ? 'ESCALATE_CONTROL_REVIEW' : 'HOLD_FOR_INFORMATION',
    nextAction: { owner, action: 'Review the changed evidence and re-submit as a new run' },
  };
  result.exceptions.push({
    code,
    failedRule: 'APPROVAL_SNAPSHOT',
    expected: 'Evidence matches the approved snapshot',
    observed,
    owner,
    nextReviewDate: reviewDate(store.clock.now().toISOString().slice(0, 10)),
    sources: [event],
  });
  result.decisionSummary = summary(result.status, false, [], result.unknowns, 'NONE');
  result.decisionSummary.approvalStatus = 'Invalidated';
  store.save(result, 'invalidate_approval');
}
