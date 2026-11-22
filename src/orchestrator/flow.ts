import type { DatabaseSync } from 'node:sqlite';
import type { ModelProvider } from '../adapters/model/provider.ts';
import type { IdGenerator } from '../adapters/clock.ts';
import { transaction } from '../adapters/migrate.ts';
import { extract, invoiceDocument } from '../evidence/extract.ts';
import type { ReadTools } from '../evidence/tools.ts';
import { policies, reconcile } from '../rules/registry.ts';
import { recommend } from '../report/recommend.ts';
import { citations } from '../report/citations.ts';
import { summary } from '../report/summary.ts';
import { WorkflowError, conflict, missing } from './errors.ts';
import {
  request,
  type ApprovalCommand,
  type Chunk,
  type RequestMeta,
  type WorkflowCase,
} from '../domain/types.ts';
import type { Store } from './runtime/store.ts';
import { step, attempt } from './runtime/step.ts';
import { freezeSnapshot, type authorised } from './approvals.ts';
import { submit } from './submit.ts';
export class Flow {
  constructor(
    readonly store: Store,
    private erp: DatabaseSync,
    private tools: ReadTools,
    private model: ModelProvider,
    private ids: IdGenerator,
  ) {}
  get(id: string) {
    return this.store.view(id) ?? missing();
  }
  async start(r: WorkflowCase['request'], meta: RequestMeta) {
    const { db } = this.store;
    const id = this.ids.next('run');
    const inserted = db
      .prepare(
        "INSERT INTO runs(id,case_id,invoice_ref,state,current_step,request_json) VALUES(?,?,?,'RUNNING','start',?) ON CONFLICT(case_id,invoice_ref) DO NOTHING",
      )
      .run(id, r.caseId, r.invoiceRef, this.store.json(r));
    if (!inserted.changes) {
      const existing = db
        .prepare('SELECT id FROM runs WHERE case_id=? AND invoice_ref=?')
        .get(r.caseId, r.invoiceRef)!;
      return this.get(String(existing.id));
    }
    this.store.event(id, meta, 'RUN_STARTED', { actor: meta.actor.id, source: meta.source });
    return this.review(id, r, meta);
  }
  async resume(id: string, meta: RequestMeta) {
    const view = this.get(id);
    if (view.status === 'RUNNING') {
      const row = this.store.db.prepare('SELECT request_json FROM runs WHERE id=?').get(id)!;
      return this.review(id, request.parse(JSON.parse(String(row.request_json))), meta);
    }
    if (view.status === 'SUBMITTING' && view.outbox?.status === 'PENDING')
      submit(this.store, this.erp, this.tools, this.ids, id, meta);
    return this.get(id);
  }
  private async review(id: string, r: WorkflowCase['request'], meta: RequestMeta) {
    const { store, tools } = this;
    const path = r.attachments?.[0];
    if (!path || !/^fixtures\/attachments\/[\w-]+\.txt$/.test(path))
      throw new WorkflowError({ type: 'Validation', issues: ['attachments'] });

    const invoice = await step(store, id, meta, 'extract', async () => {
      const { chunkId, text } = invoiceDocument(path);
      store.event(id, meta, 'MODEL_CALL', { purpose: 'extract' });
      const result = await extract(this.model, store.redact(text), chunkId);
      if (result.unknowns.length)
        store.event(id, meta, 'GROUNDING_FAILED', { fields: result.unknowns });
      return result;
    });
    const date = store.clock.now().toISOString().slice(0, 10);
    const data = await step(store, id, meta, 'gather', () => {
      const vendor = attempt(store, id, meta, 'get_vendor_record', () => tools.vendor(r.vendor));
      const poNumber = invoice.fields.poNumber?.value;
      const po = poNumber
        ? attempt(store, id, meta, 'get_purchase_order', () => tools.po(poNumber))
        : null;
      const history = attempt(store, id, meta, 'check_invoice_history', () =>
        tools.history({
          vendorId: r.vendor,
          invoiceNumber: r.invoiceRef,
          currency: r.currency,
          grossAmount: r.amount,
          invoiceDate: invoice.fields.invoiceDate?.value ?? date,
          poNumber,
        }),
      );
      const historyEvent = store.event(id, meta, 'HISTORY_CHECKED', {
        vendorId: r.vendor,
        invoiceNumber: r.invoiceRef,
        amount: r.amount,
        currency: r.currency,
        exact: history.exact,
      });
      const chunks: Chunk[] = [];
      for (const query of new Set(policies.map((p) => p.query))) {
        const asOf =
          query === policies[4].query ? date : (invoice.fields.invoiceDate?.value ?? date);
        const hits = attempt(store, id, meta, 'retrieve_finance_documents', () =>
          tools.retrieve({ query, filters: { trust: 'authority' }, topK: 3 }, asOf),
        );
        store.event(id, meta, 'RETRIEVAL', {
          query,
          asOf,
          chunks: hits.map(({ chunkId, version }) => ({ chunkId, version })),
        });
        chunks.push(...hits);
      }
      return { vendor, po, history, historyEvent, chunks };
    });
    const evidence = { ...data, invoice };
    const decision = await step(store, id, meta, 'reconcile', () => reconcile(r, evidence));
    const result = await step(store, id, meta, 'report', async () => {
      const versions = Object.fromEntries(
        data.chunks
          .filter((c) => decision.findings.some((f) => f.citation === c.citation))
          .map((c) => [c.documentId, c.version]),
      );
      const snapshot =
        decision.outcome === 'APPROVE_FOR_POSTING'
          ? freezeSnapshot({
              action: 'POST',
              vendorId: r.vendor,
              invoiceRef: r.invoiceRef,
              amount: r.amount,
              currency: r.currency,
              bankAccountVersion: data.vendor.bankAccountVersion,
              policyVersions: versions,
            })
          : null;
      store.event(id, meta, 'MODEL_CALL', { purpose: 'explain' });
      const raw = await this.model.call({
        purpose: 'explain',
        findings: decision.findings.map((f) => ({
          id: f.id,
          text:
            f.id.slice(2).replaceAll('_', ' ').toLowerCase() +
            (f.passed ? ' passed.' : ' requires review.'),
        })),
      });
      return recommend(
        id,
        r,
        evidence,
        decision,
        this.ids.next('apr'),
        snapshot,
        citations(raw, decision.findings, decision.calculations),
      );
    });
    transaction(store.db, () => {
      const next = result.proposal.nextAction,
        snap = result.approvalSnapshot;
      const name = snap ? 'request_approval' : 'report';
      if ('approvalId' in next && snap) {
        store.db
          .prepare(
            "INSERT INTO approvals(id,run_id,required_role,snapshot_json,snapshot_hash,status) VALUES(?,?,?,?,?,'PENDING')",
          )
          .run(next.approvalId, id, next.roles[0]!, store.json(snap), snap.hash);
        store.event(id, meta, 'APPROVAL_REQUESTED', {
          approvalId: next.approvalId,
          role: next.roles[0],
        });
        store.event(id, meta, 'STEP_COMPLETED', { name });
      }
      store.save(result, name);
    });
    return this.get(id);
  }
  decide(
    cmd: ApprovalCommand,
    meta: RequestMeta,
    check: (role: string, amount: string, vendorId: string) => ReturnType<typeof authorised>,
  ) {
    const { store } = this,
      { db } = store,
      id = cmd.runId;
    const decided = transaction(db, () => {
      const view = this.get(id),
        result = view.result,
        snap = result?.approvalSnapshot;
      const approval = db
        .prepare('SELECT * FROM approvals WHERE id=? AND run_id=?')
        .get(cmd.approvalId, id);
      if (!approval) return missing();
      if (
        !result ||
        !snap ||
        view.status !== 'AWAITING_APPROVAL' ||
        approval.status !== 'PENDING' ||
        approval.snapshot_hash !== snap.hash
      )
        return conflict(view.status);
      const authority = check(String(approval.required_role), snap.amount, snap.vendorId);
      if (!authority) {
        store.event(id, meta, 'APPROVAL_REFUSED', {
          actor: meta.actor.id,
          approvalId: cmd.approvalId,
        });
        return false;
      }
      const accepted = cmd.decision === 'APPROVE',
        reason = accepted ? null : store.redact(cmd.reason);
      const changed = db
        .prepare(
          "UPDATE approvals SET status=?,decided_by=?,decided_at=?,reason=? WHERE id=? AND status='PENDING'",
        )
        .run(
          accepted ? 'APPROVED' : 'REJECTED',
          store.redact(meta.actor.id),
          store.clock.now().toISOString(),
          reason,
          cmd.approvalId,
        );
      if (!changed.changes) return conflict(view.status);
      store.event(id, meta, 'APPROVAL_DECIDED', {
        ...authority,
        decision: cmd.decision,
        actor: meta.actor.id,
        approvalId: cmd.approvalId,
        reason,
      });
      result.status = accepted ? 'SUBMITTING' : 'RETURNED_TO_AP';
      if (accepted)
        db.prepare(
          "INSERT INTO outbox(idempotency_key,run_id,approval_id,finance_action,status) VALUES(?,?,?,?,'PENDING')",
        ).run(id + '/' + cmd.approvalId + '/' + snap.action, id, cmd.approvalId, snap.action);
      else result.proposal.nextAction = { owner: 'Accounts Payable', action: 'Review rejection' };
      result.decisionSummary = summary(result.status, accepted, [], result.unknowns, 'None');
      store.save(result, 'resolve_approval');
      return true;
    });
    if (!decided) throw new WorkflowError({ type: 'Unauthorized' });
    if (cmd.decision === 'APPROVE') submit(store, this.erp, this.tools, this.ids, id, meta);
    return {
      runId: id,
      approvalId: cmd.approvalId,
      decision: cmd.decision,
      status: this.get(id).status,
    };
  }
}
