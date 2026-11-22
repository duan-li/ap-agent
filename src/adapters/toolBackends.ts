import { readFileSync } from 'node:fs';
import { fixtureSchemas, type WorkflowCase } from '../domain/types.ts';
export function backends() {
  function read(name: keyof typeof fixtureSchemas): unknown {
    return JSON.parse(
      readFileSync(new URL('../../fixtures/' + name + '.json', import.meta.url), 'utf8'),
    );
  }
  return {
    vendors: fixtureSchemas.vendors.parse(read('vendors')).records,
    orders: fixtureSchemas.purchase_orders.parse(read('purchase_orders')).records,
    receipts: fixtureSchemas.receipts.parse(read('receipts')).records,
    history: fixtureSchemas.invoice_history.parse(read('invoice_history')).records,
    register: fixtureSchemas.authority_register.parse(read('authority_register')),
  };
}
export function normaliseInvoice(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// The simulated backends fail the way a remote service would. Each kind of
// failure is a distinct class so Evidence can decide what to retry.
export class BackendTimeout extends Error {
  constructor(tool: string) {
    super(tool + ' timed out');
  }
}
export class BackendUnavailable extends Error {
  constructor(tool: string) {
    super(tool + ' is temporarily unavailable');
  }
}
export class RecordNotFound extends Error {
  constructor(tool: string) {
    super(tool + ' found no record');
  }
}

export const simulatedTools = [
  'get_vendor_record',
  'get_purchase_order',
  'check_invoice_history',
] as const;
export type SimulatedTool = (typeof simulatedTools)[number];

// Fault injection reads only a case's faults block. Timeouts are served first,
// then transient errors, then the backend answers normally.
export function faultInjector(faults: WorkflowCase['faults'] = {}) {
  const remaining = Object.fromEntries(
    simulatedTools.map((tool) => [
      tool,
      { timeouts: faults[tool]?.timeoutTimes ?? 0, transient: faults[tool]?.transientTimes ?? 0 },
    ]),
  ) as Record<SimulatedTool, { timeouts: number; transient: number }>;
  return function inject(tool: SimulatedTool) {
    const left = remaining[tool];
    if (left.timeouts > 0) {
      left.timeouts--;
      throw new BackendTimeout(tool);
    }
    if (left.transient > 0) {
      left.transient--;
      throw new BackendUnavailable(tool);
    }
  };
}
