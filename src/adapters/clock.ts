export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FixedClock implements Clock {
  private epochMs: number;

  constructor(instant: string) {
    this.epochMs = Date.parse(instant);
    if (!Number.isFinite(this.epochMs)) throw new Error('Invalid clock instant');
  }

  now() {
    return new Date(this.epochMs);
  }

  advance(ms: number) {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('Invalid clock advance');
    this.epochMs += ms;
  }
}

export interface IdGenerator {
  next(prefix: string): string;
}

export function seededIds(seed: string): IdGenerator {
  let sequence = 0;
  return { next: (prefix) => `${prefix}_${seed}_${++sequence}` };
}
