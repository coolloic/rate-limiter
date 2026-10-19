import { describe, expect, it } from 'vitest';

import { consumerIdFrom } from './consumerId';

describe('consumerIdFrom', () => {
  it.each(['alice', 'partner-acme', 'A.b_c-9', 'x', 'a'.repeat(64)])('accepts %s', (id) => {
    expect(consumerIdFrom({ headers: { 'x-consumer-id': id } })).toBe(id);
  });

  it('is undefined when the header is missing', () => {
    expect(consumerIdFrom({ headers: {} })).toBeUndefined();
  });

  it.each([
    ['empty', ''],
    ['too long (65 chars)', 'a'.repeat(65)],
    ['a space', 'al ice'],
    ['a slash', 'alice/bob'],
    ['a colon', 'alice:bob'],
    ['non-ASCII', 'alicé'],
    ['a newline', 'alice\nbob'],
    ['duplicated (joined by Node)', 'alice, alice'],
  ])('is undefined when %s', (_label, id) => {
    expect(consumerIdFrom({ headers: { 'x-consumer-id': id } })).toBeUndefined();
  });

  it('is undefined when the header arrives as an array', () => {
    expect(consumerIdFrom({ headers: { 'x-consumer-id': ['alice', 'bob'] } })).toBeUndefined();
  });
});
