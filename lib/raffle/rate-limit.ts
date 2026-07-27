export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

export interface RaffleRateLimitRpcClient {
  rpc(
    name: 'consume_raffle_rate_limit',
    args: { p_key: string; p_limit: number; p_window_seconds: number },
  ): PromiseLike<{ data: unknown; error: unknown | null }>;
}

export class SupabaseRateLimiter implements RateLimiter {
  constructor(private readonly client: RaffleRateLimitRpcClient) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    try {
      const { data, error } = await this.client.rpc('consume_raffle_rate_limit', {
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });

      return error === null && data === true;
    } catch {
      return false;
    }
  }
}
