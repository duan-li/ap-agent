import { it, expect } from 'vitest';
import { AnthropicModel } from '../src/adapters/model/anthropic.ts';
import { readConfig } from '../src/adapters/config.ts';

// Offline contract for the real adapter: what it sends and how it reads the
// reply. The live suite (npm run test:live) checks the provider itself.
function transport(status: number, body: unknown) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

function message(content: unknown[], stop_reason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'test-model',
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

it('takes the model from configuration and keeps the haiku default', () => {
  expect(readConfig({}).ANTHROPIC_MODEL).toBe('claude-haiku-5-5');
  expect(readConfig({ ANTHROPIC_MODEL: 'claude-sonnet-5-5' }).ANTHROPIC_MODEL).toBe(
    'claude-sonnet-5-5',
  );
});

it('requests schema-constrained extraction and returns only the text blocks', async () => {
  const reply = '{"rationale":[]}';
  const { fetch, requests } = transport(
    200,
    message([
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: reply },
    ]),
  );
  const model = new AnthropicModel({ apiKey: 'test-key', model: 'claude-test', fetch });
  const text = await model.call({ purpose: 'extract', text: 'Invoice', chunkId: 'ATT-1' });

  expect(text).toBe(reply);
  expect(requests).toHaveLength(1);
  const [sent] = requests;
  expect(sent!.url).toMatch(/\/v1\/messages$/);
  const auth = [sent!.headers.get('x-api-key'), sent!.headers.get('authorization')].join(' ');
  expect(auth).toContain('test-key');
  expect(sent!.body).toMatchObject({
    model: 'claude-test',
    output_config: { format: { type: 'json_schema' } },
    messages: [
      {
        role: 'user',
        content: JSON.stringify({ purpose: 'extract', text: 'Invoice', chunkId: 'ATT-1' }),
      },
    ],
  });
  const schema = JSON.stringify(sent!.body.output_config);
  expect(schema).toContain('invoiceNumber');
  expect(String(sent!.body.system)).toMatch(/untrusted/i);
});

it('asks for the rationale schema when explaining findings', async () => {
  const { fetch, requests } = transport(200, message([{ type: 'text', text: '{}' }]));
  const model = new AnthropicModel({ apiKey: 'k', model: 'm', fetch });
  await model.call({ purpose: 'explain', findings: [{ id: 'F-1', text: 'ok' }] });
  const schema = JSON.stringify(requests[0]!.body.output_config);
  expect(schema).toContain('findingIds');
  expect(schema).not.toContain('invoiceNumber');
});

it('hands a refusal to validation as text instead of trusting it', async () => {
  const { fetch } = transport(200, message([], 'refusal'));
  const model = new AnthropicModel({ apiKey: 'k', model: 'm', fetch });
  expect(await model.call({ purpose: 'extract', text: 'x', chunkId: 'c' })).toBe('');
});

it('leaves retries to the run budget: a server error is one call and an error', async () => {
  const { fetch, requests } = transport(529, {
    type: 'error',
    error: { type: 'overloaded_error', message: 'Overloaded' },
  });
  const model = new AnthropicModel({ apiKey: 'k', model: 'm', fetch });
  await expect(model.call({ purpose: 'extract', text: 'x', chunkId: 'c' })).rejects.toThrow();
  expect(requests).toHaveLength(1);
});
