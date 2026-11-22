import { Decimal } from 'decimal.js';
const limits = [
  ['COST_CENTRE_MANAGER', '10000.00'],
  ['DEPARTMENT_DIRECTOR', '50000.00'],
  ['EXECUTIVE_DIRECTOR', '250000.00'],
  ['CHIEF_FINANCIAL_OFFICER', '1000000.00'],
] as const;
export function approvalRequirement(gross: string) {
  const [role, limit] = limits.find(([, cap]) => new Decimal(gross).lte(cap)) ?? [
    'CHIEF_EXECUTIVE_OFFICER',
    'Unlimited',
  ];
  return { role, limit };
}
