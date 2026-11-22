import type { ReadTools } from '../../evidence/tools.ts';
export function duplicate(history: ReturnType<ReadTools['history']>) {
  return history.exact.length > 0;
}
