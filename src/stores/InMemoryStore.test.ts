import { describe, expect, it } from 'vitest';

import type { StateTransition } from '@/interfaces';
import { FakeClock } from '@/testing';

import { InMemoryStore } from './InMemoryStore';

const TTL_MS = 1_000;

// Counts updates per key: the new state is also the result, so tests see what the store passed in.
function increment(previous: number | undefined): StateTransition<number, number> {
  const state = (previous ?? 0) + 1;
  return { state, result: state };
}

function setup(): { readonly clock: FakeClock; readonly store: InMemoryStore<number> } {
  const clock = new FakeClock();
  return { clock, store: new InMemoryStore<number>(clock) };
}

describe('InMemoryStore', () => {
  it('passes undefined to the transition for a new key', async () => {
    const { store } = setup();
    const seen: (number | undefined)[] = [];

    await store.update('k', TTL_MS, (previous) => {
      seen.push(previous);
      return { state: 1, result: undefined };
    });

    expect(seen).toEqual([undefined]);
  });

  it("returns the transition's result", async () => {
    const { store } = setup();

    const result = await store.update('k', TTL_MS, () => ({ state: 7, result: 'done' }));

    expect(result).toBe('done');
  });

  it('rejects when the transition throws, and keeps the previous state', async () => {
    const { store } = setup();
    await store.update('k', TTL_MS, increment);
    const failure = new Error('boom');

    const pending = store.update('k', TTL_MS, () => {
      throw failure;
    });

    await expect(pending).rejects.toBe(failure);
    expect(await store.update('k', TTL_MS, increment)).toBe(2);
  });

  it('carries the state over to the next update within the TTL', async () => {
    const { clock, store } = setup();

    await store.update('k', TTL_MS, increment);
    clock.advance(TTL_MS - 1);

    expect(await store.update('k', TTL_MS, increment)).toBe(2);
  });

  it('restarts the TTL on every write', async () => {
    const { clock, store } = setup();

    await store.update('k', TTL_MS, increment);
    clock.advance(TTL_MS - 1);
    await store.update('k', TTL_MS, increment);
    clock.advance(TTL_MS - 1);

    expect(await store.update('k', TTL_MS, increment)).toBe(3);
  });

  it('reads the state as undefined exactly at the expiry boundary', async () => {
    const { clock, store } = setup();

    await store.update('k', TTL_MS, increment);
    clock.advance(TTL_MS);

    expect(await store.update('k', TTL_MS, increment)).toBe(1);
  });

  it('reads expired state as undefined', async () => {
    const { clock, store } = setup();

    await store.update('k', TTL_MS, increment);
    clock.advance(TTL_MS * 5);

    expect(await store.update('k', TTL_MS, increment)).toBe(1);
  });

  it('keeps keys independent', async () => {
    const { store } = setup();

    await store.update('a', TTL_MS, increment);
    await store.update('a', TTL_MS, increment);

    expect(await store.update('b', TTL_MS, increment)).toBe(1);
    expect(await store.update('a', TTL_MS, increment)).toBe(3);
  });

  it('evicts idle keys once their TTL has passed, so memory does not grow unbounded', async () => {
    const { clock, store } = setup();
    for (let i = 0; i < 100; i++) await store.update(`consumer-${String(i)}`, TTL_MS, increment);
    expect(store.size).toBe(100);

    clock.advance(TTL_MS);
    await store.update('someone-else', TTL_MS, increment);

    expect(store.size).toBe(1);
  });

  it('sweeps at most once per TTL', async () => {
    const { clock, store } = setup();
    await store.update('a', TTL_MS, increment); // t=0: sweep runs, next one due at t=1000
    clock.set(999);
    await store.update('b', TTL_MS, increment); // expires at t=1999
    clock.set(1_000);
    await store.update('c', TTL_MS, increment); // sweep evicts 'a', next one due at t=2000
    expect(store.size).toBe(2);

    clock.set(1_999);
    await store.update('d', TTL_MS, increment); // 'b' has expired, but no sweep is due yet
    expect(store.size).toBe(3);

    clock.set(2_000);
    await store.update('e', TTL_MS, increment); // sweep evicts 'b' and 'c'
    expect(store.size).toBe(2);
  });
});
