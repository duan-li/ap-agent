import type { RequestMeta, StartRunCommand, ApprovalCommand } from './apService.ts';

export type Envelope = { meta: RequestMeta } & (
  | { command: 'startRun'; payload: StartRunCommand }
  | { command: 'getRun' | 'resume'; payload: { runId: string } }
  | { command: 'resolveApproval'; payload: ApprovalCommand }
);
