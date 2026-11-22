import type { Index, Query, Chunk } from '../domain/types.ts';
const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
export function retrieve(index: Index, { query, filters, topK }: Query, date: string): Chunk[] {
  const docs = index.flatMap(({ allowed, supersededDate, ...chunk }) => {
    const trust: Chunk['trust'] = !allowed
      ? 'untrusted'
      : chunk.effectiveDate &&
          (chunk.effectiveDate > date || (supersededDate && date >= supersededDate))
        ? 'historical'
        : 'authority';
    if (
      (filters.trust && filters.trust !== trust) ||
      (filters.type && filters.type !== chunk.type) ||
      (filters.status && filters.status !== chunk.status)
    )
      return [];
    const heading = chunk.text.split('\n')[0]!;
    return [{ chunk: { ...chunk, trust }, words: tokens(heading + ' ' + chunk.text) }];
  });
  const average = docs.reduce((sum, d) => sum + d.words.length, 0) / docs.length;
  const terms = [...new Set(tokens(query))];
  const frequencies = terms.map((term) => docs.filter((d) => d.words.includes(term)).length);
  return docs
    .map(({ chunk, words }) => {
      const score = terms.reduce((sum, term, i) => {
        const tf = words.filter((w) => w === term).length;
        const df = frequencies[i]!;
        const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
        return sum + (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * words.length) / average));
      }, 0);
      return { ...chunk, rank: 0, score };
    })
    .filter((c) => c.score >= 1)
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
    .slice(0, topK)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}
