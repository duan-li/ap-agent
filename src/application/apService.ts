import type { z } from 'zod';
import type { OutboxStatus, request, runResult } from '../domain/types.ts';

export type StartRunCommand = z.input<typeof request>;

export interface RequestMeta {
  deliveryId: string;
  correlationId: string;
  actor: { id: string; via: 'cli-flag' | 'signed-webhook' | 'service-identity' };
  source: 'cli' | 'http' | 'queue';
  deadline: number;
  signal: AbortSignal;
}

export type ApprovalCommand = { runId: string; approvalId: string } & (
  | { decision: 'APPROVE' }
  | { decision: 'REJECT'; reason: string }
);

type RunResult = z.output<typeof runResult>;

export interface RunView {
  runId: string;
  caseId: string;
  status: RunResult['status'];
  currentStep: string;
  budget: { steps: string; toolCalls: string; modelCalls: string };
  outbox: { status: OutboxStatus; postingRef: string | null } | null;
  result: RunResult | null;
  events: Array<{
    ts: string;
    type: string;
    runId: string;
    correlationId: string;
    [field: string]: z.infer<ReturnType<typeof z.json>>;
  }>;
}

export interface ApprovalResponse {
  runId: string;
  approvalId: string;
  decision: ApprovalCommand['decision'];
  status: RunResult['status'];
}

export type AppError =
  | { type: 'Validation'; issues: string[] }
  | { type: 'Unauthorized' }
  | { type: 'Conflict'; currentState: string }
  | { type: 'NotFound' }
  | { type: 'Transient'; retryAfterMs?: number }
  | { type: 'DeadlineExceeded'; runId?: string };

export type Result<T = RunView | ApprovalResponse> =
  | { kind: 'ok'; value: T }
  | { kind: 'duplicate'; value: T }
  | { kind: 'error'; error: AppError };

export interface ApService {
  startRun(command: StartRunCommand, meta: RequestMeta): Promise<Result<RunView>>;
  getRun(runId: string, meta: RequestMeta): Promise<Result<RunView>>;
  resolveApproval(command: ApprovalCommand, meta: RequestMeta): Promise<Result<ApprovalResponse>>;
  resume(runId: string, meta: RequestMeta): Promise<Result<RunView>>;
}
