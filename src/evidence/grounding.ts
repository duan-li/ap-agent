type Field = { value: string; quote: string; chunkId: string };
const normalise = (value: string) => value.replace(/[$,]/g, '').replace(/\s+/g, ' ').trim();
export function grounded(field: Field, text: string, chunkId: string) {
  if (field.chunkId !== chunkId || !text.includes(field.quote)) return false;
  const value = normalise(field.value).replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
  return (
    value.length > 0 &&
    new RegExp('(?<![\\w.])' + value + '(?![\\w.])').test(normalise(field.quote))
  );
}
