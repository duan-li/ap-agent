import { it, expect } from 'vitest';
import golden from '../cases/retrieval_golden.json' with { type: 'json' };
import { ingest } from '../src/evidence/ingest.ts';
import { retrieve } from '../src/evidence/retrieve.ts';
it.each(golden.queries)(
  '$id ranks current authority',
  ({ query, top, mustNotAuthorise, expectNoAuthority }) => {
    const hits = retrieve(
      ingest(),
      { query, filters: { trust: 'authority' }, topK: 3 },
      '2026-11-22',
    );
    expect(hits.map((h) => h.documentId + ' ' + h.section)).toEqual(expect.arrayContaining(top));
    expect(hits.some((h) => mustNotAuthorise.includes(h.documentId))).toBe(false);
    if (expectNoAuthority) expect(hits).toHaveLength(0);
  },
);
