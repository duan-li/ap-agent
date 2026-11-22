// Fixture account numbers may also appear in quoted text or free-form actor input.
export function redactor(accounts: string[]) {
  const patterns = accounts.map((number) => new RegExp(number.split('').join('[ -]*'), 'g'));
  return (input: string) =>
    patterns
      .reduce((s, p, i) => s.replace(p, '****' + accounts[i]!.slice(-4)), input)
      .replace(
        /(\baccount(?: number)?\s*[:#]?\s*(?:ending\s+)?)(\d(?:[ -]?\d){4,})/gi,
        (_, label: string, digits: string) => label + '****' + digits.replace(/\D/g, '').slice(-4),
      );
}
