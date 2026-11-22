import { readFileSync } from 'node:fs';
import type { ModelProvider } from '../adapters/model/provider.ts';
import { invoiceExtraction, supplierClaims } from '../domain/types.ts';
import { grounded } from './grounding.ts';
type Field = { value: string; quote: string; chunkId: string };
export interface Extraction {
  fields: Record<string, Field>;
  unknowns: string[];
  lineCount: number;
  suspicious: boolean;
}
export async function extract(
  model: ModelProvider,
  text: string,
  chunkId: string,
): Promise<Extraction> {
  const raw: unknown = JSON.parse(await model.call({ purpose: 'extract', text, chunkId }));
  if (supplierClaims.safeParse(raw).success) return { ...missingInvoice(), suspicious: true };
  const invoice = invoiceExtraction.parse(raw);
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

export function invoiceDocument(path: string) {
  const match = /^fixtures\/attachments\/([\w-]+)\.txt$/.exec(path);
  if (!match) throw new Error('Invalid invoice attachment path');
  return {
    chunkId: 'ATT-' + match[1],
    text: readFileSync(new URL('../../' + path, import.meta.url), 'utf8'),
  };
}

export function missingInvoice(): Extraction {
  return { fields: {}, unknowns: ['invoiceLines'], lineCount: 0, suspicious: false };
}

// Keep supplier instructions outside the model's decision inputs. Only these
// observations, with the originating attachment, cross into the rules layer.
export interface SupplierSignal {
  id: string;
  ref: string;
  kind: 'account' | 'urgency' | 'bypass';
  value: string;
  quote: string;
  fullAccount?: boolean;
}

export function supplierSignals(text: string, ref: string): SupplierSignal[] {
  const signals: SupplierSignal[] = [];
  for (const match of text.matchAll(
    /\baccount(?: number)?\s*[:#]?\s*(?:ending\s+)?\**(\d(?:[ -]?\d){3,})\b/gi,
  )) {
    const digits = match[1]!.replace(/\D/g, '');
    const last4 = digits.slice(-4);
    signals.push({
      id: ref + '#account-' + signals.length,
      ref,
      kind: 'account',
      value: last4,
      quote: digits.length === 4 ? match[0] : last4,
      fullAccount: digits.length > 4,
    });
  }
  const patterns = {
    urgency: /\burgent(?:ly)?\b|\bsecret\b|\bconfidential(?:ly)?\b/i,
    bypass:
      /ignore all previous (?:policies|instructions)|skip duplicate detection|do not ask a human approver|bypass (?:normal )?approval/i,
  };
  for (const kind of ['urgency', 'bypass'] as const) {
    const quote = patterns[kind].exec(text)?.[0];
    if (quote) signals.push({ id: ref + '#' + kind, ref, kind, value: quote, quote });
  }
  return signals;
}

export function supplementarySignals(path: string) {
  if (/^fixtures\/attachments\/[\w-]+\.txt$/.test(path)) {
    const doc = invoiceDocument(path);
    return supplierSignals(doc.text, doc.chunkId);
  }
  if (!/^corpus\/[\w-]+\.md$/.test(path)) throw new Error('Invalid supplementary attachment');
  const raw = readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
  const [, header, body] = raw.split(/^---\s*$/m);
  if (!header || !body) throw new Error('Invalid corpus attachment');
  return supplierSignals(body, /^document_id: ([\w-]+)$/m.exec(header)?.[1] ?? path);
}
