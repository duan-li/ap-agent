import { readFileSync } from 'node:fs';
import type { ModelProvider } from '../adapters/model/provider.ts';
import { invoiceExtraction } from '../domain/types.ts';
import { grounded } from './grounding.ts';
type Field = { value: string; quote: string; chunkId: string };
export async function extract(model: ModelProvider, text: string, chunkId: string) {
  const invoice = invoiceExtraction.parse(
    JSON.parse(await model.call({ purpose: 'extract', text, chunkId })),
  );
  const fields: Record<string, Field> = {};
  const unknowns: string[] = [];
  function add(name: string, field?: Field, numeric = false) {
    if (!field || !grounded(field, text, chunkId)) {
      unknowns.push(name);
      return;
    }
    const value = numeric ? field.value.replace(/[$,]/g, '') : field.value;
    if (numeric && !/^\d+(?:\.\d+)?$/.test(value)) {
      unknowns.push(name);
      return;
    }
    fields[name] = { ...field, value };
  }
  add('invoiceNumber', invoice.invoiceNumber);
  add('invoiceDate', invoice.invoiceDate);
  add('poNumber', invoice.poNumber);
  add('currency', invoice.currency);
  add('totalAmount', invoice.totalAmountRaw, true);
  add('taxAmount', invoice.taxAmountRaw, true);
  invoice.lines.forEach((line, i) => {
    const prefix = 'line' + (i + 1) + '.';
    add(prefix + 'description', line.description);
    add(prefix + 'quantity', line.quantityRaw, true);
    add(prefix + 'unitPrice', line.unitPriceRaw, true);
    add(prefix + 'lineAmount', line.lineAmountRaw, true);
  });
  return {
    fields,
    unknowns,
    lineCount: invoice.lines.length,
    suspicious: invoice.suspiciousContent.length > 0,
  };
}
export type Extraction = Awaited<ReturnType<typeof extract>>;

export function invoiceDocument(path: string) {
  const match = /^fixtures\/attachments\/([\w-]+)\.txt$/.exec(path);
  if (!match) throw new Error('Invalid invoice attachment path');
  return {
    chunkId: 'ATT-' + match[1],
    text: readFileSync(new URL('../../' + path, import.meta.url), 'utf8'),
  };
}
