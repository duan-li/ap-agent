import type { Review } from '../domain/types.ts';
type Outcome = Review['proposal']['outcome'];
const order: Outcome[] = [
  'APPROVE_FOR_POSTING',
  'HOLD_FOR_INFORMATION',
  'REJECT_INVALID',
  'REJECT_DUPLICATE',
  'ESCALATE_CONTROL_REVIEW',
];
export function tighten(current: Outcome, next: Outcome): Outcome {
  return order.indexOf(next) > order.indexOf(current) ? next : current;
}
