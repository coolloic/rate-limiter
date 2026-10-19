// Composition root: wire concrete classes here and export the public API.
export { acquire, withRateLimit } from '@/client';
export type { AcquireOptions } from '@/client';
export { getConfig } from '@/config';
export type { Env } from '@/config';
export { DEFAULT_RESOURCE, RateLimiter, SystemClock } from '@/domain';
export type { Consumer, LimitPolicy, RateLimitResult } from '@/domain';
export { AppError, InvalidArgumentError, RateLimitError, RateLimitTimeoutError } from '@/errors';
export type { DeniedRateLimitResult } from '@/errors';
export { createRateLimiter } from '@/factories';
export type { RateLimiterOptions } from '@/factories';
export { toRateLimitHeaders } from '@/http';
export type {
  Clock,
  PolicyResolver,
  RateLimitStore,
  RateLimitStrategy,
  StateTransition,
} from '@/interfaces';
export { ConfigurablePolicyResolver } from '@/policies';
export type { PolicyRules } from '@/policies';
export { InMemoryStore } from '@/stores';
export { SlidingWindowLogStrategy } from '@/strategies';
export type { SlidingWindowLog } from '@/strategies';

export { rateLimit } from './rateLimit';
