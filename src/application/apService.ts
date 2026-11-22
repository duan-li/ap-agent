import { deliver, validateCallback } from './inbox.ts';
import { withLease } from '../orchestrator/runtime/lease.ts';
import type { Flow } from '../orchestrator/flow.ts';
import { ApplicationError, toAppError, type AppError } from './errors.ts';
import { authorised } from '../orchestrator/approvals.ts';
import type { backends } from '../adapters/toolBackends.ts';
import { z } from 'zod';
import {
  type RequestMeta,
  type ApprovalCommand,
  type RunView,
  type approvalResponse,
  request,
  requestMetadata,
} from '../domain/types.ts';

export type StartRunCommand = z.input<typeof request>;

export type ApprovalResponse = z.infer<typeof approvalResponse>;

export type { RequestMeta, ApprovalCommand, RunView } from '../domain/types.ts';
export type { AppError } from './errors.ts';

export type Result<T = RunView | ApprovalResponse> =
  { kind: 'ok'; value: T } | { kind: 'duplicate'; value: T } | { kind: 'error'; error: AppError };

export interface ApService {
  startRun(command: StartRunCommand, meta: RequestMeta): Promise<Result<RunView>>;
  getRun(runId: string, meta: RequestMeta): Promise<Result<RunView>>;
  resolveApproval(command: ApprovalCommand, meta: RequestMeta): Promise<Result<ApprovalResponse>>;
  resume(runId: string, meta: RequestMeta): Promise<Result<RunView>>;
}

export function service(flow: Flow, data: ReturnType<typeof backends>): ApService {
  async function execute<T>(meta: RequestMeta, work: () => T | Promise<T>): Promise<Result<T>> {
    try {
      requestMetadata.parse(meta);
      if (meta.signal.aborted || meta.deadline <= flow.store.clock.now().getTime())
        throw new ApplicationError({ type: 'DeadlineExceeded' });
      return { kind: 'ok', value: await work() };
    } catch (e) {
      return { kind: 'error', error: toAppError(e) };
    }
  }
  return {
    startRun: (cmd: StartRunCommand, meta) =>
      execute(meta, () => {
        const r = request.parse(cmd);
        if (
          flow.store.redact(r.caseId) !== r.caseId ||
          flow.store.redact(r.invoiceRef) !== r.invoiceRef
        )
          throw new ApplicationError({ type: 'Validation', issues: ['invoice identifiers'] });
        return flow.start(r, meta);
      }),
    getRun: (id, meta) => execute(meta, () => flow.get(z.string().min(1).parse(id))),
    resume: (id, meta) => execute(meta, () => flow.resume(z.string().min(1).parse(id), meta)),
    async resolveApproval(input, meta) {
      const outer = await execute(meta, () => {
        const cmd = validateCallback(flow.store, input, meta);
        return withLease(flow.store, cmd.runId, meta.deadline, () =>
          deliver(
            flow.store,
            cmd,
            meta,
            (markApplied) =>
              flow.decide(
                cmd,
                meta,
                (role, amount, vendorId) =>
                  data.vendors.find((v) => v.vendorId === vendorId)?.createdBy === meta.actor.id
                    ? null
                    : authorised(
                        data.register,
                        meta.actor.id,
                        role,
                        amount,
                        flow.store.clock.now().toISOString().slice(0, 10),
                      ),
                markApplied,
              ),
            async () => {
              const view = await flow.continueRun(cmd.runId, meta);
              return {
                runId: cmd.runId,
                approvalId: cmd.approvalId,
                decision: cmd.decision,
                status: view.status,
              };
            },
          ),
        );
      });
      return outer.kind === 'error' ? outer : outer.value;
    },
  };
}
