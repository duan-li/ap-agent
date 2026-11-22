export type WorkflowFailure =
  | { type: 'Validation'; issues: string[] }
  | { type: 'Unauthorized' }
  | { type: 'NotFound' }
  | { type: 'Conflict'; currentState: string };

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
