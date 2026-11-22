import type { Review } from '../domain/types.ts';
export function summary(
  status: Review['status'],
  eligible: boolean,
  roles: string[],
  unknowns: string[],
  action: string,
) {
  let approvalStatus = 'No approval pending';
  let paymentEligibility = 'Ineligible for posting';
  if (status === 'AWAITING_APPROVAL') {
    approvalStatus = 'Awaiting ' + roles.join(', ') + ' (0 of ' + roles.length + ' approvals)';
    if (eligible) paymentEligibility = 'Eligible for posting once approved';
  } else if (status === 'SUBMITTING') {
    approvalStatus = 'Approved';
    if (eligible) paymentEligibility = 'Eligible for posting';
  } else if (action === 'POST') {
    approvalStatus = 'Approved';
    paymentEligibility = 'Posted';
  } else if (action === 'REJECT_INVOICE') {
    approvalStatus = 'Approved';
  } else if (status === 'RETURNED_TO_AP') {
    approvalStatus = 'Rejected';
  }
  return {
    paymentEligibility,
    approvalStatus,
    missingEvidence: unknowns,
    financeActionTaken: action,
  };
}
