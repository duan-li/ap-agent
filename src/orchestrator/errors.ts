export type WorkflowFailure =
  | { type: 'Validation'; issues: string[] }
  | { type: 'Unauthorized' }
  | { type: 'NotFound' }
  | { type: 'Conflict'; currentState: string }
  | { type: 'DeadlineExceeded'; runId?: string };

export class WorkflowError extends Error {
  constructor(readonly detail: WorkflowFailure) {
    super(detail.type);
  }
}

export function conflict(currentState: string): never {
  throw new WorkflowError({ type: 'Conflict', currentState });
}

export function missing(): never {
  throw new WorkflowError({ type: 'NotFound' });
}

// A run that cannot continue ends FAILED with one of these reasons.
export type FailureReason =
  'BUDGET_EXCEEDED' | 'MODEL_OUTPUT_INVALID_AFTER_REPAIR' | 'TOOL_UNAVAILABLE';

export class RunFailure extends Error {
  constructor(
    readonly reason: FailureReason,
    readonly detail: Record<string, string | number> = {},
  ) {
    super(reason);
  }
}

export type BudgetKind = 'steps' | 'tool_calls' | 'model_calls';
export class BudgetExceeded extends RunFailure {
  constructor(kind: BudgetKind, limit: number) {
    super('BUDGET_EXCEEDED', { limit: kind, max: limit });
  }
}
