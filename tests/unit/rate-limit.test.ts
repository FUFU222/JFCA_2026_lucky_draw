import { describe, expect, it } from 'vitest';

import {
  SupabaseRateLimiter,
  type RateLimiter,
  type RaffleRateLimitRpcClient,
} from '../../lib/raffle/rate-limit';

class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; startedAt: number }>();

  constructor(private now = 0) {}

  advance(seconds: number): void {
    this.now += seconds * 1_000;
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const bucket = this.buckets.get(key);
    const windowMs = windowSeconds * 1_000;

    if (!bucket || this.now >= bucket.startedAt + windowMs) {
      this.buckets.set(key, { count: 1, startedAt: this.now });
      return true;
    }

    if (bucket.count >= limit) {
      return false;
    }

    bucket.count += 1;
    return true;
  }
}

describe('RateLimiter', () => {
  it('allows requests through the threshold and resets after the window', async () => {
    const limiter = new InMemoryRateLimiter();

    await expect(limiter.consume('ip:127.0.0.1', 2, 60)).resolves.toBe(true);
    await expect(limiter.consume('ip:127.0.0.1', 2, 60)).resolves.toBe(true);
    await expect(limiter.consume('ip:127.0.0.1', 2, 60)).resolves.toBe(false);

    limiter.advance(60);

    await expect(limiter.consume('ip:127.0.0.1', 2, 60)).resolves.toBe(true);
  });
});

describe('SupabaseRateLimiter', () => {
  it('delegates consumption to the raffle rate-limit RPC', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client: RaffleRateLimitRpcClient = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: true, error: null };
      },
    };

    await expect(new SupabaseRateLimiter(client).consume('email:ada@example.com', 3, 120)).resolves.toBe(
      true,
    );
    expect(calls).toEqual([
      {
        name: 'consume_raffle_rate_limit',
        args: { key: 'email:ada@example.com', limit: 3, window_seconds: 120 },
      },
    ]);
  });

  it('fails closed when the RPC errors or returns a non-boolean result', async () => {
    const erroringClient: RaffleRateLimitRpcClient = {
      rpc: async () => ({ data: null, error: new Error('database unavailable') }),
    };
    const malformedClient: RaffleRateLimitRpcClient = {
      rpc: async () => ({ data: 'true', error: null }),
    };

    await expect(new SupabaseRateLimiter(erroringClient).consume('key', 1, 60)).resolves.toBe(false);
    await expect(new SupabaseRateLimiter(malformedClient).consume('key', 1, 60)).resolves.toBe(false);
  });

  it('fails closed when the RPC call throws', async () => {
    const throwingClient: RaffleRateLimitRpcClient = {
      rpc: async () => {
        throw new Error('network unavailable');
      },
    };

    await expect(new SupabaseRateLimiter(throwingClient).consume('key', 1, 60)).resolves.toBe(false);
  });
});
