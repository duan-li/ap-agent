import type { ApService } from '../application/apService.ts';
import type { Envelope } from '../application/commands.ts';

export function dispatch(app: ApService, e: Envelope) {
  switch (e.command) {
    case 'startRun':
      return app.startRun(e.payload, e.meta);
    case 'getRun':
      return app.getRun(e.payload.runId, e.meta);
    case 'resume':
      return app.resume(e.payload.runId, e.meta);
    case 'resolveApproval':
      return app.resolveApproval(e.payload, e.meta);
  }
}
