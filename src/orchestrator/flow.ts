import type { DatabaseSync } from 'node:sqlite';
import type { ModelProvider } from '../adapters/model/provider.ts';
import type { IdGenerator } from '../adapters/clock.ts';
import {
  ModelOutputInvalid,
  extract,
  invoiceDocument,
  missingInvoice,
  supplementarySignals,
} from '../evidence/extract.ts';
import {
  submitEvidence,
  DeadlineReached,
  ToolFailure,
  checkDeadline,
  type ReadTools,
} from '../evidence/tools.ts';
import {
  policies,
  reconcile,
  bankQueries,
  duplicateQuery,
  missingEvidenceQuery,
  receiptQuery,
  type PoLookup,
} from '../rules/registry.ts';
import { bankDetails } from '../rules/checks/bankDetails.ts';
import { recommend } from '../report/recommend.ts';
import { citations } from '../report/citations.ts';
import { summary } from '../report/summary.ts';
import { BudgetExceeded, RunFailure, WorkflowError, conflict, missing } from './errors.ts';
import {
  request,
  type ApprovalCommand,
  type Chunk,
  type RequestMeta,
  type WorkflowCase,
} from '../domain/types.ts';
import { defaultBudget, type BudgetLimits, type Store } from './runtime/store.ts';
import { step, attempt } from './runtime/step.ts';
import { freezeSnapshot, authorityMatches, invalidate, type authorised } from './approvals.ts';
import { withLease } from './runtime/lease.ts';
import { submit } from './submit.ts';
export class Flow {
  constructor(
    readonly store: Store,
    private erp: DatabaseSync,
    private tools: ReadTools,
    private model: ModelProvider,
    private ids: IdGenerator,
    private limits: BudgetLimits = defaultBudget,
    private simulation: WorkflowCase['faults'] = {},
  ) {}
  get(id: string) {
    return this.store.view(id) ?? missing();
  }
  async start(r: WorkflowCase['request'], meta: RequestMeta) {
    const { db } = this.store;
    const id = this.ids.next('run');
    const inserted = this.store.write(() => {
      const row = db
        .prepare(
          "INSERT INTO runs(id,case_id,invoice_ref,state,current_step,request_json,max_steps,max_tool_calls,max_model_calls,simulation_json) VALUES(?,?,?,'RUNNING','start',?,?,?,?,?) ON CONFLICT(case_id,invoice_ref) DO NOTHING",
        )
        .run(
          id,
          r.caseId,
          r.invoiceRef,
          this.store.json(r),
          this.limits.maxSteps,
          this.limits.maxToolCalls,
          this.limits.maxModelCalls,
          this.store.json(this.simulation),
        );
      if (row.changes)
        this.store.event(id, meta, 'RUN_STARTED', { actor: meta.actor.id, source: meta.source });
      return row;
    });
    if (!inserted.changes) {
      const existing = db
        .prepare('SELECT id FROM runs WHERE case_id=? AND invoice_ref=?')
        .get(r.caseId, r.invoiceRef)!;
      return this.get(String(existing.id));
    }
    return this.resume(id, meta);
  }
  async resume(id: string, meta: RequestMeta) {
    return withLease(this.store, id, meta.deadline, () => this.continueRun(id, meta), meta.signal);
  }
  async continueRun(id: string, meta: RequestMeta) {
    const view = this.get(id);
    if (view.status === 'RUNNING') {
      const row = this.store.db.prepare('SELECT request_json FROM runs WHERE id=?').get(id)!;
      return this.review(id, request.parse(JSON.parse(String(row.request_json))), meta);
    }
    if (
      view.status === 'SUBMITTING' &&
      (view.outbox?.status === 'PENDING' || view.outbox?.status === 'SENDING')
    )
      await this.send(id, meta, true);
    return this.get(id);
  }
  // Every failure ends in a named state: FAILED with a reason, or a deadline
  // that leaves the run at its last checkpoint for `ap resume`.
  private async guarded(id: string, meta: RequestMeta, work: () => Promise<unknown>) {
    try {
      await work();
    } catch (error) {
      if (error instanceof DeadlineReached)
        throw new WorkflowError({ type: 'DeadlineExceeded', runId: id });
      if (error instanceof RunFailure) this.store.fail(id, meta, error);
      else if (error instanceof ModelOutputInvalid)
        this.store.fail(id, meta, new RunFailure('MODEL_OUTPUT_INVALID_AFTER_REPAIR'));
      else if (error instanceof ToolFailure)
        this.store.fail(
          id,
          meta,
          new RunFailure('TOOL_UNAVAILABLE', { tool: error.tool, attempts: error.attempts }),
        );
      else throw error;
    }
    return this.get(id);
  }
  private async send(id: string, meta: RequestMeta, resumed = false) {
    try {
      await submit(
        this.store,
        this.erp,
        submitEvidence(this.tools, this.store.simulation(id), resumed),
        this.ids,
        id,
        meta,
      );
    } catch (error) {
      if (error instanceof DeadlineReached)
        throw new WorkflowError({ type: 'DeadlineExceeded', runId: id });
      // The budget is checked before the intent moves to SENDING, so a
      // refusal here always means nothing was sent.
      if (!(error instanceof BudgetExceeded)) throw error;
      this.store.fail(id, meta, error);
    }
  }
  // Each model call is charged to the run budget and audited before it starts.
  // It is aborted at the request deadline, and a reply that arrives after the
  // deadline on the injected clock is discarded.
  private modelFor(id: string, meta: RequestMeta): ModelProvider {
    const { store } = this;
    const limits = { clock: store.clock, deadline: meta.deadline, signal: meta.signal };
    return {
      call: async (req) => {
        checkDeadline(limits);
        store.spend(id, 'model_calls');
        store.event(id, meta, 'MODEL_CALL', { purpose: req.purpose });
        const remaining = meta.deadline - store.clock.now().getTime();
        const signal = AbortSignal.any([meta.signal, AbortSignal.timeout(remaining)]);
        let reply: string;
        try {
          reply = await this.model.call(req, signal);
        } catch (error) {
          if (signal.aborted) throw new DeadlineReached();
          throw error;
        }
        checkDeadline(limits);
        return reply;
      },
    };
  }
  private review(id: string, r: WorkflowCase['request'], meta: RequestMeta) {
    return this.guarded(id, meta, () => this.reviewSteps(id, r, meta));
  }
  private async reviewSteps(id: string, r: WorkflowCase['request'], meta: RequestMeta) {
    const { store, tools } = this;
    const model = this.modelFor(id, meta);
    const path = r.attachments?.[0];
    if (path && !/^fixtures\/attachments\/[\w-]+\.txt$/.test(path))
      throw new WorkflowError({ type: 'Validation', issues: ['attachments'] });

    const invoice = await step(store, id, meta, 'extract', async () => {
      if (!path) return missingInvoice();
      const { chunkId, text } = invoiceDocument(path);
      const result = await extract(model, store.redact(text), chunkId, {
        invalid: (attempt, issue) =>
          store.event(id, meta, 'MODEL_OUTPUT_INVALID', { attempt, issue }),
        repaired: () => store.event(id, meta, 'MODEL_OUTPUT_REPAIRED', { attempts: 2 }),
      });
      if (result.unknowns.length)
        store.event(id, meta, 'GROUNDING_FAILED', { fields: result.unknowns });
      return result;
    });
    const date = store.clock.now().toISOString().slice(0, 10);
    const data = await step(store, id, meta, 'gather', async () => {
      const signals = (r.attachments ?? []).flatMap(supplementarySignals);
      const vendor = await attempt(store, id, meta, 'get_vendor_record', () =>
        tools.vendor(r.vendor),
      );
      const poNumber = invoice.fields.poNumber?.value;
      let po: ReturnType<ReadTools['po']> | null = null;
      let poLookup: PoLookup | undefined;
      if (poNumber) {
        // An unreachable PO is missing evidence, not a missing receipt:
        // Rules hold the run and list both as unknowns.
        try {
          po = await attempt(store, id, meta, 'get_purchase_order', () => tools.po(poNumber));
          poLookup = { status: 'FOUND' };
        } catch (error) {
          if (!(error instanceof ToolFailure)) throw error;
          poLookup = {
            status: error.reason === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNAVAILABLE',
            attempts: error.attempts,
            reason: error.reason,
          };
        }
      }
      const history = await attempt(store, id, meta, 'check_invoice_history', () =>
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
      const queries = new Set<string>(policies.map((p) => p.query));
      if (history.exact.length) queries.add(duplicateQuery);
      if (bankDetails(signals, vendor.bankLast4).indicators.length)
        bankQueries.forEach((q) => queries.add(q));
      if (poNumber && (!po || !po.receipts.length)) queries.add(receiptQuery);
      if (poLookup?.status === 'UNAVAILABLE') queries.add(missingEvidenceQuery);
      for (const query of queries) {
        const asOf =
          query === policies[4].query ? date : (invoice.fields.invoiceDate?.value ?? date);
        const hits = await attempt(store, id, meta, 'retrieve_finance_documents', () =>
          tools.retrieve({ query, filters: { trust: 'authority' }, topK: 3 }, asOf),
        );
        store.event(id, meta, 'RETRIEVAL', {
          query,
          asOf,
          chunks: hits.map(({ chunkId, version }) => ({ chunkId, version })),
        });
        chunks.push(...hits);
      }
      return { vendor, po, poLookup, history, historyEvent, chunks, signals };
    });
    const evidence = {
      ...data,
      invoice,
      signals: data.signals ?? (r.attachments ?? []).flatMap(supplementarySignals),
      asOf: date,
    };
    const journalled = await step(store, id, meta, 'reconcile', () => reconcile(r, evidence));
    // A partially completed M1 run may have a duplicate verdict without the
    // policy and history evidence now required to request a rejection.
    const decision = journalled.exceptions ? journalled : reconcile(r, evidence);
    const result = await step(store, id, meta, 'report', async () => {
      const versions = Object.fromEntries(
        data.chunks
          .filter((c) => decision.findings.some((f) => f.citation === c.citation))
          .map((c) => [c.documentId, c.version]),
      );
      const snapshot =
        decision.outcome === 'APPROVE_FOR_POSTING' || decision.outcome === 'REJECT_DUPLICATE'
          ? freezeSnapshot({
              action: decision.outcome === 'REJECT_DUPLICATE' ? 'REJECT_INVOICE' : 'POST',
              vendorId: r.vendor,
              invoiceRef: r.invoiceRef,
              amount: r.amount,
              currency: r.currency,
              bankAccountVersion: data.vendor.bankAccountVersion,
              policyVersions: versions,
            })
          : null;
      const raw = await model.call({
        purpose: 'explain',
        findings: decision.findings.map((f) => ({
          id: f.id,
          text:
            f.id.slice(2).replaceAll('_', ' ').toLowerCase() +
            (f.passed ? ' passed.' : ' requires review.'),
        })),
      });
      const { explanation, rejected } = citations(raw, decision.findings, decision.calculations);
      if (rejected) {
        store.event(id, meta, 'CITATION_INVALID', { rejected });
      }
      return recommend(id, r, evidence, decision, this.ids.next('apr'), snapshot, explanation);
    });
    store.write(() => {
      const next = result.proposal.nextAction,
        snap = result.approvalSnapshot;
      const name = snap ? 'request_approval' : 'report';
      if ('approvalId' in next && snap) {
        // Requesting approval is a step of its own. If the budget refuses
        // it, the transaction rolls back and no approval exists.
        store.spend(id, 'steps');
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
    if (result.approvalSnapshot) store.crash(id, 'crashAfterStep', 'request_approval');
  }
  async decide(
    cmd: ApprovalCommand,
    meta: RequestMeta,
    check: (role: string, amount: string, vendorId: string) => ReturnType<typeof authorised>,
    markApplied: () => void,
  ) {
    const { store } = this,
      { db } = store,
      id = cmd.runId;
    const decide = async () => {
      const view = this.get(id);
      const result = view.result;
      const snap = result?.approvalSnapshot;
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
      const valid = await authorityMatches(store, this.tools, id, meta, snap);
      return store.write(() => {
        if (!valid) {
          invalidate(
            store,
            id,
            meta,
            result,
            cmd.approvalId,
            'AUTHORITY_GAP',
            'Authority policy changed',
          );
          markApplied();
          return true;
        }
        // Recording the decision is a step. A refusal rolls back, so the
        // approval stays PENDING on a run that then ends FAILED.
        store.spend(id, 'steps');
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
        result.decisionSummary = summary(
          result.status,
          accepted && snap.action === 'POST',
          [],
          result.unknowns,
          'NONE',
        );
        store.save(result, 'resolve_approval');
        store.event(id, meta, 'STEP_COMPLETED', { name: 'resolve_approval' });
        markApplied();
        return true;
      });
    };
    let decided: boolean;
    try {
      decided = await decide();
    } catch (error) {
      if (error instanceof DeadlineReached)
        throw new WorkflowError({ type: 'DeadlineExceeded', runId: id });
      if (!(error instanceof BudgetExceeded)) throw error;
      store.write(() => {
        store.fail(id, meta, error);
        markApplied();
      });
      return {
        runId: id,
        approvalId: cmd.approvalId,
        decision: cmd.decision,
        status: this.get(id).status,
      };
    }
    if (!decided) throw new WorkflowError({ type: 'Unauthorized' });
    store.crash(id, 'crashAfterStep', 'resolve_approval');
    if (this.get(id).status === 'SUBMITTING') await this.send(id, meta);
    return {
      runId: id,
      approvalId: cmd.approvalId,
      decision: cmd.decision,
      status: this.get(id).status,
    };
  }
}
