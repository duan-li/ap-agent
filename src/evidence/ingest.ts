import { readFileSync, readdirSync } from 'node:fs';
import { indexSchema, trustList } from '../domain/types.ts';
export function ingest(dir = new URL('../../corpus/', import.meta.url)) {
  const read = (name: string) => readFileSync(new URL(name, dir), 'utf8');
  const allowlist = trustList.parse(JSON.parse(read('trust.json'))).policyAuthority;
  return indexSchema.parse(
    readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .flatMap((file) => {
        const [, header, body] = read(file).split(/^---\s*$/m);
        if (!header || !body) throw new Error('Invalid corpus file ' + file);
        const meta = Object.fromEntries(
          Array.from(header.matchAll(/^([\w_]+): (.+)$/gm), (m) => [m[1], m[2]]),
        );
        const parts = body.split(/^## /m);
        const sections = parts.length > 1 ? parts.slice(1) : parts;
        return sections.map((text, i) => {
          const n = text.match(/^(\d+)\./)?.[1] ?? String(i + 1);
          const { document_id: documentId, version, effective_date: effectiveDate, status } = meta;
          const section = '§' + n;
          return {
            chunkId: documentId + '@' + version + '#' + n,
            documentId,
            version,
            section,
            effectiveDate,
            status,
            type: allowlist.includes(documentId) ? 'policy' : 'document',
            allowed: allowlist.includes(documentId),
            supersededDate: meta.superseded_date ?? null,
            text: text.trim(),
            citation: documentId + ' v' + version + ' ' + section,
          };
        });
      }),
  );
}
