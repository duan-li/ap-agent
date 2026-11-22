import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normaliseInvoice } from '../src/adapters/toolBackends.ts';
import { openApp } from '../src/entrypoints/handle.ts';
import { FakeModel } from '../src/adapters/model/fake.ts';
import { FixedClock, seededIds } from '../src/adapters/clock.ts';
import type { WorkflowCase } from '../src/domain/types.ts';
export async function openTestRun(setup: Pick<WorkflowCase, 'id' | 'faults' | 'modelScript'>) {
  const dir = mkdtempSync(join(tmpdir(), 'ap-eval-'));
  const logs: string[] = [];
  try {
    const clock = new FixedClock('2026-11-22T00:00:00Z');
    const ids = seededIds(setup.id);
    const open = (faults?: WorkflowCase['faults']) =>
      openApp(
        dir,
        {
          model: new FakeModel(setup.modelScript),
          clock,
          ids,
          faults,
        },
        (line) => logs.push(line),
      );
    let runtime = open(setup.faults);
    return {
      get app() {
        return runtime.app;
      },
      reopen() {
        runtime.close();
        runtime = open();
      },
      approvalStatus: (id: string) =>
        String(
          runtime.db.prepare('SELECT status FROM approvals WHERE run_id=?').get(id)?.status ?? '',
        ),
      metrics() {
        const approval = runtime.db.prepare(`
          SELECT a.decided_at, a.snapshot_json FROM approvals a JOIN outbox o
            ON a.id=o.approval_id AND a.run_id=o.run_id
          WHERE a.status='APPROVED' AND a.decided_by IS NOT NULL
            AND o.idempotency_key=? AND o.finance_action=?
            AND o.idempotency_key=a.run_id || '/' || a.id || '/' || o.finance_action
        `);
        const postings = runtime.erp.prepare('SELECT * FROM erp_postings').all();
        const unapproved = postings.filter((p) => {
          const row = approval.get(p.idempotency_key!, p.finance_action!);
          if (!row || String(row.decided_at) > String(p.received_at)) return true;
          const snapshot = JSON.parse(String(row.snapshot_json));
          return (
            snapshot.action !== p.finance_action ||
            snapshot.vendorId !== p.vendor_id ||
            normaliseInvoice(snapshot.invoiceRef) !== p.invoice_no_normalised ||
            snapshot.amount !== p.amount ||
            snapshot.currency !== p.currency
          );
        });
        const citations = runtime.db
          .prepare(
            `
          SELECT json_extract(f.value,'$.citation') AS citation
          FROM runs, json_each(runs.result_json,'$.policyFindings') f
        `,
          )
          .all();
        return {
          attempts: this.submitAttempts(),
          actions: postings.length,
          unapproved: unapproved.length,
          adversarial: citations.filter((row) => /^ADV-/.test(String(row.citation))).length,
        };
      },
      financeWrites: () =>
        Number(runtime.erp.prepare('SELECT count(*) n FROM erp_postings').get()?.n),
      approvedDecisions: () =>
        Number(
          runtime.db.prepare("SELECT count(*) n FROM approvals WHERE status='APPROVED'").get()?.n,
        ),
      submitAttempts: () =>
        logs.filter((l) => {
          const e = JSON.parse(l);
          return e.type === 'TOOL_CALL' && e.name === 'submit_finance_decision';
        }).length,
      postings: () =>
        runtime.erp
          .prepare(
            'SELECT posting_ref, finance_action, invoice_no_normalised, idempotency_key FROM erp_postings',
          )
          .all(),
      historyRecords: () => runtime.historyRecords(),
      vendorMaster: () => runtime.vendorMaster(),
      logs: () => logs.join('\n'),
      sqliteContents: () =>
        readdirSync(dir)
          .filter((p) => p.includes('.db'))
          .map((p) => readFileSync(join(dir, p)).toString('latin1'))
          .join('\n'),
      close() {
        runtime.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
