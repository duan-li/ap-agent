import type { ReadTools } from '../../evidence/tools.ts';
export function vendorActive(vendor: ReturnType<ReadTools['vendor']>) {
  return vendor.status === 'ACTIVE' && vendor.verified && !vendor.riskFlags.length;
}
