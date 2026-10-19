import type { Consumer, LimitPolicy } from '@/domain';

/** Maps a consumer to the `LimitPolicy` that applies to it. */
export interface PolicyResolver {
  resolve(consumer: Consumer): LimitPolicy;
}
