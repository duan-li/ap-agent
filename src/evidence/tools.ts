import { Decimal } from 'decimal.js';
import { normaliseInvoice, type backends } from '../adapters/toolBackends.ts';
import {
  toolSchemas as s,
  type Index,
  type Query,
  type HistoryQuery,
  type WorkflowCase,
} from '../domain/types.ts';
import { retrieve } from './retrieve.ts';
export function readTools(
  data: ReturnType<typeof backends>,
  index: Index,
  faults: WorkflowCase['faults'] = {},
) {
  let poTimeouts = faults.get_purchase_order?.timeoutTimes ?? 0;
  return {
    retrieve(query: Query, date: string) {
      return s.retrieve_finance_documents.output.parse(
        retrieve(index, s.retrieve_finance_documents.input.parse(query), date),
      );
    },
    vendor(id: string) {
      const { vendorId } = s.get_vendor_record.input.parse({ vendorId: id });
      const v = data.vendors.find((v) => v.vendorId === vendorId);
      if (!v) throw new Error('Vendor unavailable');
      return s.get_vendor_record.output.parse({
        vendorId,
        status: v.status,
        riskFlags: v.riskFlags,
        bankLast4: v.bank.accountNumber.slice(-4),
        bankAccountVersion: v.bank.lastChangedAt,
        lastChangedAt: v.bank.lastChangedAt,
        verified: v.bank.verified,
        lastUpdated: v.lastUpdated,
      });
    },
    po(id: string) {
      const { poNumber } = s.get_purchase_order.input.parse({ poNumber: id });
      if (poTimeouts > 0) {
        poTimeouts--;
        throw new Error('Purchase order timed out');
      }
      return s.get_purchase_order.output.parse({
        ...data.orders.find((p) => p.poNumber === poNumber),
        receipts: data.receipts.filter((r) => r.poNumber === poNumber),
      });
    },
    history(input: HistoryQuery) {
      const q = s.check_invoice_history.input.parse(input);
      const exact = data.history.filter(
        (h) =>
          h.vendorId === q.vendorId &&
          h.currency === q.currency &&
          h.normalisedNumber === normaliseInvoice(q.invoiceNumber) &&
          new Decimal(h.grossAmount).eq(q.grossAmount),
      );
      return s.check_invoice_history.output.parse({
        exact: exact.map((h) => ({
          recordId: h.historyId,
          status: h.status,
          matchBasis: 'vendor, invoice and gross amount',
        })),
        fuzzy: [],
      });
    },
  };
}
export type ReadTools = ReturnType<typeof readTools>;
