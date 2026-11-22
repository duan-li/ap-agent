import { approvalCommand, approvalResponse, cachedApprovalError } from '../domain/types.ts';
import { createHash } from 'node:crypto';
import type { ApprovalCommand, RequestMeta, ApprovalResponse, Result } from './apService.ts';
import { WorkflowError, conflict } from '../orchestrator/errors.ts';
import type { Store } from '../orchestrator/runtime/store.ts';

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// An already-bound delivery ID cannot be reassigned, even to a malformed edit.
export function validateCallback(store: Store, input: ApprovalCommand, meta: RequestMeta) {
  const parsed = approvalCommand.safeParse(input);
  if (parsed.success) return parsed.data;
  if (store.db.prepare('SELECT 1 FROM inbox WHERE delivery_id=?').get(hash(meta.deliveryId)))
    return conflict('Delivery ID reused');
  throw parsed.error;
}

export async function deliver(
  store: Store,
  cmd: ApprovalCommand,
  meta: RequestMeta,
  decide: (markApplied: () => void) => Promise<ApprovalResponse>,
  recover: () => Promise<ApprovalResponse>,
): Promise<Result<ApprovalResponse>> {
  const { db } = store;
  // Hash the opaque delivery ID too, since it is supplied by the caller.
  const key = hash(meta.deliveryId);
  const requestHash = hash([
    meta.actor.id,
    cmd.runId,
    cmd.approvalId,
    cmd.decision,
    cmd.decision === 'REJECT' ? cmd.reason : null,
  ]);
  const row = store.write(() => {
    db.prepare(
      'INSERT INTO inbox(delivery_id,request_hash,received_at) VALUES(?,?,?) ON CONFLICT DO NOTHING',
    ).run(key, requestHash, store.clock.now().getTime());
    return db.prepare('SELECT * FROM inbox WHERE delivery_id=?').get(key)!;
  });
  if (row.request_hash !== requestHash) return conflict('Delivery ID reused');
  if (row.response_json) {
    store.event(cmd.runId, meta, 'APPROVAL_DUPLICATE_IGNORED', { approvalId: cmd.approvalId });
    const body: unknown = JSON.parse(String(row.response_json));
    const error = cachedApprovalError.safeParse(body);
    if (error.success) return { kind: 'error', error: error.data };
    return { kind: 'duplicate', value: approvalResponse.parse(body) };
  }
  try {
    const response = row.applied
      ? await recover()
      : await decide(() => {
          db.prepare('UPDATE inbox SET applied=1 WHERE delivery_id=?').run(key);
        });
    save(response);
    return { kind: 'ok', value: response };
  } catch (error) {
    if (error instanceof WorkflowError && cachedApprovalError.safeParse(error.detail).success) {
      save(error.detail);
    }
    throw error;
  }
  function save(body: unknown) {
    store.write(() =>
      db.prepare('UPDATE inbox SET response_json=? WHERE delivery_id=?').run(store.json(body), key),
    );
  }
}
