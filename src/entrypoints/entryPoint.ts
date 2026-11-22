import type { Envelope } from '../application/commands.ts';
import type { RequestMeta, Result, StartRunCommand } from '../application/apService.ts';
import { parseArgs } from 'node:util';
import { ApplicationError } from '../application/errors.ts';
export type Actor = RequestMeta['actor'];

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  checks: { name: string; ok: boolean; detail?: string }[];
}

export interface EntryPoint<Raw, Out> {
  readonly name: 'cli' | 'http' | 'queue';
  start(): Promise<void>;
  stop(): Promise<void>;
  authenticate(raw: Raw): Promise<Actor>;
  decode(raw: Raw, actor: Actor): Envelope;
  encode(result: Result, raw: Raw): Out;
  health?(): Promise<HealthReport>;
}

export function decode(argv: string[]) {
  function invalid(): never {
    throw new ApplicationError({ type: 'Validation', issues: ['Invalid command or arguments'] });
  }
  const [command, ...args] = argv;
  if (command === 'ingest' || command === 'eval') {
    if (args.length) invalid();
    return { command } as const;
  }
  if (command === 'start') {
    if (args.length !== 2 || args[0] !== '--case' || !args[1]) return invalid();
    return { command, path: args[1] } as const;
  }
  const [id, ...flags] = args;
  if (!id || id.startsWith('-')) return invalid();
  if (command === 'get' || command === 'resume') {
    if (flags.length) invalid();
    return { command, id } as const;
  }
  if (command !== 'approve' && command !== 'reject') return invalid();
  let values;
  try {
    values = parseArgs({
      args: flags,
      options: {
        approval: { type: 'string' },
        approver: { type: 'string' },
        reason: { type: 'string' },
        'delivery-id': { type: 'string' },
      },
    }).values;
  } catch {
    return invalid();
  }
  if (
    !values.approval ||
    !values.approver ||
    (command === 'reject' && !values.reason) ||
    (command === 'approve' && values.reason)
  )
    return invalid();
  return {
    command,
    id,
    approval: values.approval,
    actor: values.approver,
    reason: values.reason,
    deliveryId: values['delivery-id'],
  } as const;
}

export function envelope(
  cmd: ReturnType<typeof decode>,
  meta: RequestMeta,
  request?: StartRunCommand,
): Envelope {
  switch (cmd.command) {
    case 'start':
      if (!request) throw new ApplicationError({ type: 'Validation', issues: ['request'] });
      return { command: 'startRun', payload: request, meta };
    case 'get':
      return { command: 'getRun', payload: { runId: cmd.id }, meta };
    case 'resume':
      return { command: 'resume', payload: { runId: cmd.id }, meta };
    case 'approve':
      return {
        command: 'resolveApproval',
        payload: { runId: cmd.id, approvalId: cmd.approval, decision: 'APPROVE' },
        meta,
      };
    case 'reject':
      return {
        command: 'resolveApproval',
        payload: {
          runId: cmd.id,
          approvalId: cmd.approval,
          decision: 'REJECT',
          reason: cmd.reason!,
        },
        meta,
      };
    default:
      throw new ApplicationError({ type: 'Validation', issues: ['Expected workflow command'] });
  }
}
