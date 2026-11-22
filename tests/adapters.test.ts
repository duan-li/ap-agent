import { expect, it } from 'vitest';
import { FixedClock, seededIds } from '../src/adapters/clock.ts';
import { readConfig } from '../src/adapters/config.ts';

it('defaults to the offline provider and identifies invalid settings by name', () => {
  expect(readConfig({}).MODEL_PROVIDER).toBe('fake');
  expect(() => readConfig({ MODEL_PROVIDER: 'anthropic' })).toThrow('ANTHROPIC_API_KEY');
  expect(() => readConfig({ MODEL_PROVIDER: 'unknown' })).toThrow('MODEL_PROVIDER');
});

it('advances time explicitly and reproduces the ID sequence', () => {
  const clock = new FixedClock('2026-11-22T00:00:00Z');
  clock.advance(25);
  expect(clock.now().toISOString()).toBe('2026-11-22T00:00:00.025Z');
  const sequence = () => {
    const ids = seededIds('fixture');
    return [ids.next('run'), ids.next('run')];
  };
  expect(new Set(sequence()).size).toBe(2);
  expect(sequence()).toEqual(sequence());
});
