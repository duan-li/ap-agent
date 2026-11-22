import { describe, it, expect } from 'vitest';
import { loadCases, evaluateCase, runCase } from '../../eval/caseHarness.ts';
import { AnthropicModel } from '../../src/adapters/model/anthropic.ts';
import { readConfig } from '../../src/adapters/config.ts';

// Model-dependent integration run. It calls the Anthropic API, costs tokens
// and is never part of `npm test`. Run it with `npm run test:live` and
// ANTHROPIC_API_KEY set; ANTHROPIC_MODEL overrides the default model.
const key = process.env.ANTHROPIC_API_KEY?.trim();
const brief = ['FIN-001', 'FIN-002', 'FIN-003', 'FIN-004', 'FIN-005'];
// Read the model name without demanding a key, so a skipped suite still loads.
const { ANTHROPIC_MODEL } = readConfig({ ...process.env, MODEL_PROVIDER: 'fake' });

describe.skipIf(!key)('live Anthropic provider on the five brief cases', () => {
  const model = new AnthropicModel({ apiKey: key ?? '', model: ANTHROPIC_MODEL });
  const cases = loadCases().filter((workflow) => brief.includes(workflow.id));

  it('loads all five brief cases', () => {
    expect(cases.map((workflow) => workflow.id).sort()).toEqual(brief);
  });

  it.each(cases)(
    '$id meets its expected control behaviour with ' + ANTHROPIC_MODEL,
    async (workflow) => {
      const result = await evaluateCase(workflow, (w) => runCase(w, undefined, model));
      expect(result.actual, workflow.id).toBe('PASS');
    },
    180_000,
  );
});
