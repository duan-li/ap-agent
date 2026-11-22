import type { ApService } from '../application/apService.ts';
import type { EntryPoint } from './entryPoint.ts';
import { toAppError } from '../application/errors.ts';
import { dispatch } from './dispatch.ts';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '../adapters/sqlite.ts';
import { Store, defaultBudget, type BudgetLimits } from '../orchestrator/runtime/store.ts';
import { service } from '../application/apService.ts';
import { Flow } from '../orchestrator/flow.ts';
import { ingest } from '../evidence/ingest.ts';
import { indexSchema, durabilityFaults, type WorkflowCase } from '../domain/types.ts';
import { readTools } from '../evidence/tools.ts';
import { backends } from '../adapters/toolBackends.ts';
import { redactor } from '../adapters/redact.ts';
import type { Clock, IdGenerator } from '../adapters/clock.ts';
import type { ModelProvider } from '../adapters/model/provider.ts';
export function openApp(
  dir: string,
  options: {
    model: ModelProvider;
    clock: Clock;
    ids: IdGenerator;
    faults?: WorkflowCase['faults'];
  },
  log: (s: string) => void,
) {
  const supported = [
    'get_purchase_order',
    'get_vendor_record',
    'check_invoice_history',
    'budget',
    'erpLookupFails',
    'crashAfterStep',
    'crashAfterErpPost',
    'crashAfterOutboxSending',
    'vendorChangeBeforeSubmit',
    'vendorChangeBeforeResume',
  ];
  if (Object.keys(options.faults ?? {}).some((key) => !supported.includes(key)))
    throw new Error('Fault simulation is not available for these settings');
  mkdirSync(dir, { recursive: true });
  const data = backends(),
    redact = redactor(data.vendors.map((v) => v.bank.accountNumber));
  const path = join(dir, 'index.json');
  const index = existsSync(path)
    ? indexSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    : ingest();
  const db = openDatabase(join(dir, 'ap.db'), 'migrations'),
    erp = openDatabase(join(dir, 'erp-sim.db'), 'erp-sim');
  const store = new Store(db, options.clock, redact, log);
  const tools = readTools(data, index, options.faults);
  const flow = new Flow(
    store,
    erp,
    tools,
    options.model,
    options.ids,
    lowered(options.faults),
    durabilityFaults.parse(options.faults ?? {}),
  );
  return {
    app: service(flow, data),
    db,
    erp,
    redact,
    historyRecords: () => data.history,
    vendorMaster: () => data.vendors,
    close() {
      db.close();
      erp.close();
    },
  };
}

// Case limits can only tighten the defaults, whoever builds the options.
function lowered(faults: WorkflowCase['faults'] = {}): BudgetLimits {
  const limit = (key: keyof BudgetLimits) =>
    Math.min(defaultBudget[key], faults.budget?.[key] ?? defaultBudget[key]);
  return {
    maxSteps: limit('maxSteps'),
    maxToolCalls: limit('maxToolCalls'),
    maxModelCalls: limit('maxModelCalls'),
  };
}

export async function handle<Raw, Out>(
  entry: EntryPoint<Raw, Out>,
  app: ApService,
  raw: Raw,
): Promise<Out> {
  try {
    const actor = await entry.authenticate(raw);
    const command = entry.decode(raw, actor);
    return entry.encode(await dispatch(app, command), raw);
  } catch (error) {
    return entry.encode({ kind: 'error', error: toAppError(error) }, raw);
  }
}
