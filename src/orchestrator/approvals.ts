import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import type { backends } from '../adapters/toolBackends.ts';
import type { Review } from '../domain/types.ts';
export function authorised(
  register: ReturnType<typeof backends>['register'],
  actor: string,
  role: string,
  amount: string,
  date: string,
) {
  const person = register.approvers.find((p) => p.userId === actor);
  const eligible =
    register.effectiveFrom <= date &&
    !!person &&
    person.role === role &&
    new Decimal(person.limitAud).gte(amount);
  return eligible
    ? { role: person.role, limitAud: person.limitAud, registerVersion: register.registerVersion }
    : null;
}
type Snapshot = NonNullable<Review['approvalSnapshot']>;
export function freezeSnapshot(fields: Omit<Snapshot, 'hash'>): Snapshot {
  const entries = Object.entries({
    ...fields,
    policyVersions: Object.entries(fields.policyVersions).sort(),
  }).sort();
  return {
    ...fields,
    hash: 'sha256:' + createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
  };
}
