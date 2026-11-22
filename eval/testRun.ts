import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
