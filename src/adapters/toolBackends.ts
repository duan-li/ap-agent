import { readFileSync } from 'node:fs';
import { fixtureSchemas } from '../domain/types.ts';
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
