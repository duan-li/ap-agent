import type { AppError, Result } from '../application/apService.ts';
export function exitCode(type: AppError['type']) {
  return {
    Validation: 2,
    Unauthorized: 3,
    Conflict: 4,
    NotFound: 5,
    Transient: 75,
    DeadlineExceeded: 75,
  }[type];
}
export function encode(result: Result) {
  return result.kind === 'error'
    ? { code: exitCode(result.error.type), data: result.error }
    : { code: 0, data: result.value };
}
