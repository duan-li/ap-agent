import type { ReadTools } from '../../evidence/tools.ts';
export function duplicate(history: ReturnType<ReadTools['history']>) {
  return history.exact.filter((h) => h.status === 'PAID' || h.status === 'POSTED');
}
