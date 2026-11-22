export interface Clock {
  now(): Date;
  // Waits for a backoff. A fixed clock advances instead, so no test waits.
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class FixedClock implements Clock {
  private epochMs: number;

  constructor(instant: string) {
    this.epochMs = Date.parse(instant);
    if (!Number.isFinite(this.epochMs)) throw new Error('Invalid clock instant');
  }

  now() {
    return new Date(this.epochMs);
  }

  async sleep(ms: number) {
    this.advance(ms);
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
