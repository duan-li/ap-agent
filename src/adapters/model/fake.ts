import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { invoiceExtraction, modelScript } from '../../domain/types.ts';
import type { ModelProvider, ModelRequest } from './provider.ts';

type Call = z.infer<typeof modelScript>['calls'][number];

function loadCalls(path: string) {
  if (!/^fixtures\/model_scripts\/[\w-]+\.json$/.test(path))
    throw new Error('Invalid model script path');
  return modelScript.parse(
    JSON.parse(readFileSync(new URL('../../../' + path, import.meta.url), 'utf8')),
  ).calls;
}

function reply(call: Call): string {
  if ('rawResponse' in call) return call.rawResponse;
  if (call.response === 'inherit:FIN-001') {
    const inherited = loadCalls('fixtures/model_scripts/FIN-001.json').find(
      (item) => item.purpose === call.purpose,
    );
    if (!inherited || !('response' in inherited) || typeof inherited.response !== 'object') {
      throw new Error('Missing reference reply for ' + call.purpose);
    }
    return JSON.stringify(inherited.response);
  }
  return JSON.stringify(call.response);
}

function extract(invoice: string, chunkId: string) {
  const field = (value: string, quote: string) => ({ value, quote, chunkId });
  function header(pattern: RegExp, group = 1) {
    const match = pattern.exec(invoice);
    if (!match?.[group]) throw new Error('Missing fixed-format invoice field');
    return field(match[group], match[0]);
  }
  const linePattern = /^\d+\. (.+?) {2}Qty (\d+) {2}Unit (\$[\d,.]+) {2}Amount (\$[\d,.]+)$/gm;
  const totalPattern = /^Total due \(([A-Z]{3})\) (\$[\d,.]+)$/m;
  const lines = Array.from(
    invoice.matchAll(linePattern),
    ([quote, description, qty, price, amount]) => ({
      description: field(description!, quote),
      quantityRaw: field(qty!, quote),
      unitPriceRaw: field(price!, quote),
      lineAmountRaw: field(amount!, quote),
    }),
  );
  const po = /^Purchase order: (.+)$/m.exec(invoice);
  return invoiceExtraction.parse({
    invoiceNumber: header(/^Invoice No: (.+)$/m),
    invoiceDate: header(/^Invoice date: (.+)$/m),
    poNumber: po && po[1] ? field(po[1], po[0]) : undefined,
    currency: header(totalPattern),
    totalAmountRaw: header(totalPattern, 2),
    taxAmountRaw: header(/^GST [\d.]+% (\$[\d,.]+)$/m),
    lines,
    suspiciousContent: [],
  });
}

export class FakeModel implements ModelProvider {
  private readonly calls?: Call[];
  private cursor = 0;

  constructor(script = 'default') {
    if (script !== 'default') this.calls = loadCalls(script);
  }

  async call(request: ModelRequest): Promise<string> {
    if (this.calls) {
      const call = this.calls[this.cursor];
      if (call?.purpose !== request.purpose)
        throw new Error('Unexpected scripted call: ' + request.purpose);
      this.cursor++;
      return reply(call);
    }
    if (request.purpose === 'explain') {
      return JSON.stringify({
        rationale: request.findings.map(({ id, text }) => ({ text, findingIds: [id] })),
      });
    }
    return JSON.stringify(extract(request.text, request.chunkId));
  }
}
