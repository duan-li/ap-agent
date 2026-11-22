import { ZodError } from 'zod';
import { WorkflowError, type WorkflowFailure } from '../orchestrator/errors.ts';

export type AppError =
  | WorkflowFailure
  | { type: 'Transient'; retryAfterMs?: number }
  | { type: 'DeadlineExceeded'; runId?: string };

export class ApplicationError extends Error {
  constructor(readonly detail: AppError) {
    super(detail.type);
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof ApplicationError || error instanceof WorkflowError) return error.detail;
  if (error instanceof ZodError) {
    return {
      type: 'Validation',
      issues: error.issues.map((issue) => issue.path.join('.') || 'input'),
    };
  }
  return { type: 'Transient' };
}
