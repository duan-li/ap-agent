#!/usr/bin/env -S node --import tsx
import { evaluate } from '../../eval/runEval.ts';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  realpathSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import { join } from 'node:path';
import { readConfig } from '../adapters/config.ts';
import { caseSetup } from '../domain/types.ts';
import { FakeModel } from '../adapters/model/fake.ts';
import { AnthropicModel } from '../adapters/model/anthropic.ts';
import { systemClock } from '../adapters/clock.ts';
import { ingest } from '../evidence/ingest.ts';

import type { ApService, RequestMeta, Result, StartRunCommand } from '../application/apService.ts';
import { decode as parseCommand, envelope, type Actor, type EntryPoint } from './entryPoint.ts';
import { openApp, handle } from './handle.ts';
import { encode as encodeResult } from './json.ts';

type CliOut = { stdout: string; exitCode: number };

interface CliContext {
  request?: StartRunCommand;
  meta: Omit<RequestMeta, 'actor'>;
  redact(text: string): string;
}

export class CliEntryPoint implements EntryPoint<string[], CliOut> {
  readonly name = 'cli';

  constructor(
    private app: ApService,
    private argv: string[],
    private context: CliContext,
  ) {}

  async start() {
    const out = await handle(this, this.app, this.argv);
    console.log(out.stdout);
    process.exitCode = out.exitCode;
  }

  async stop() {
    // A single invocation has no listener to shut down.
  }

  async authenticate(argv: string[]): Promise<Actor> {
    const command = parseCommand(argv);
    return { id: command.actor ?? 'local-operator', via: 'cli-flag' };
  }

  decode(argv: string[], actor: Actor) {
    const command = parseCommand(argv);
    const meta = {
      ...this.context.meta,
      actor,
      deliveryId: command.deliveryId ?? callbackDeliveryId(command) ?? this.context.meta.deliveryId,
    };
    return envelope(command, meta, this.context.request);
  }

  encode(result: Result): CliOut {
    const { data, code } = encodeResult(result);
    return { stdout: this.context.redact(JSON.stringify(data)), exitCode: code };
  }
}

// Without --delivery-id, an approval callback is identified by its own content.
// Repeating the same decision by the same approver is then a redelivery and
// gets the stored first response; any change in content is a new callback.
export function callbackDeliveryId(command: ReturnType<typeof parseCommand>) {
  if (command.command !== 'approve' && command.command !== 'reject') return undefined;
  const content = [command.command, command.id, command.approval, command.actor, command.reason];
  return 'cli-' + createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

async function main(argv: string[]) {
  const [command] = argv;
  if (command === 'eval') {
    parseCommand(argv);
    await evaluate();
    return;
  }
  const cfg = readConfig();
  if (command === 'ingest') {
    parseCommand(argv);
    const chunks = ingest();
    mkdirSync(cfg.DATA_DIR, { recursive: true });
    const path = join(cfg.DATA_DIR, 'index.json'),
      tmp = path + '.' + randomUUID();
    writeFileSync(tmp, JSON.stringify(chunks));
    renameSync(tmp, path);
    console.log(JSON.stringify({ chunks: chunks.length }));
    return;
  }
  const cmd = command === 'start' ? parseCommand(argv) : undefined;
  const workflow =
    cmd?.command === 'start'
      ? caseSetup.parse(JSON.parse(readFileSync(cmd.path, 'utf8')))
      : undefined;
  const model =
    cfg.MODEL_PROVIDER === 'anthropic'
      ? new AnthropicModel({ apiKey: cfg.ANTHROPIC_API_KEY!, model: cfg.ANTHROPIC_MODEL })
      : new FakeModel(workflow?.modelScript);
  const runtime = openApp(
    cfg.DATA_DIR,
    {
      model,
      clock: systemClock,
      ids: { next: (prefix) => prefix + '_' + randomUUID() },
      faults: workflow?.faults,
    },
    (line) => console.error(line),
  );
  const cli = new CliEntryPoint(runtime.app, argv, {
    request: workflow?.request,
    redact: runtime.redact,
    meta: {
      source: 'cli',
      deliveryId: randomUUID(),
      correlationId: randomUUID(),
      deadline: systemClock.now().getTime() + 60000,
      signal: AbortSignal.timeout(60000),
    },
  });
  try {
    await cli.start();
  } finally {
    await cli.stop();
    runtime.close();
  }
}
// npm may invoke this file through a bin symlink.
const script = process.argv[1];
if (script && existsSync(script) && pathToFileURL(realpathSync(script)).href === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch {
    const out = encodeResult({
      kind: 'error',
      error: {
        type: 'Validation',
        issues: ['Check command arguments, case file and environment settings'],
      },
    });
    console.log(JSON.stringify(out.data));
    process.exitCode = out.code;
  }
}
