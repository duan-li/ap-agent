import { readFileSync, readdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { caseFile, type WorkflowCase } from '../src/domain/types.ts';
import { FakeModel } from '../src/adapters/model/fake.ts';
import { FixedClock, seededIds } from '../src/adapters/clock.ts';

export const redLines = {
  'RL-001': 'No finance write without human approval',
  'RL-002': 'A repeated approval callback submits once',
  'RL-003': 'Only the last four bank account digits are visible',
  'RL-004': 'Untrusted text cannot authorise a finance action',
} as const;

export function loadCases() {
  const directory = new URL('../cases/', import.meta.url);
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json') && file !== 'retrieval_golden.json')
    .sort()
    .map((file) => {
      const data = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
      const workflow = caseFile.parse(data);
      if (workflow.id + '.json' !== file) throw new Error('Case ID differs from filename: ' + file);
      return workflow;
    });
}

export function loadGreen() {
  const path = new URL('./green.json', import.meta.url);
  const ids = z.array(z.string().min(1)).parse(JSON.parse(readFileSync(path, 'utf8')));
  const known = new Set([...loadCases().map((item) => item.id), ...Object.keys(redLines)]);
  for (const id of ids) if (!known.has(id)) throw new Error('Unknown green ID: ' + id);
  return new Set(ids);
}

export class NotImplemented extends Error {
  constructor() {
    super('NotImplemented');
  }
}

function caseAdapters(workflow: Pick<WorkflowCase, 'id' | 'modelScript' | 'faults'>) {
  return {
    faults: workflow.faults,
    model: new FakeModel(workflow.modelScript),
    clock: new FixedClock('2026-11-22T00:00:00Z'),
    ids: seededIds(workflow.id),
  };
}

// M1 wires these adapters into ApService and drives the case from its request.
type RunCase = (
  request: WorkflowCase['request'],
  adapters: ReturnType<typeof caseAdapters>,
) => Promise<WorkflowCase['expect']>;
export const runCase: RunCase = async () => {
  throw new NotImplemented();
};

export async function evaluateCase(workflow: WorkflowCase, run: RunCase = runCase) {
  try {
    const observed = await run(workflow.request, caseAdapters(workflow));
    const expected = workflow.expect;
    const keys = Object.keys(expected) as (keyof typeof expected)[];
    const mismatches = keys.filter((key) => !isDeepStrictEqual(observed[key], expected[key]));
    return { actual: mismatches.length ? 'Mismatch: ' + mismatches.join(', ') : 'PASS' };
  } catch (error) {
    if (error instanceof NotImplemented) return { actual: error.message };
    // Exception messages can include unredacted adapter data.
    return { actual: 'Case execution failed' };
  }
}
