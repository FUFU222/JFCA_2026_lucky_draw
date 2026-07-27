/**
 * Shared gate for the suites that talk to a real database.
 *
 * Locally the suites skip when no credentials are configured, so `pnpm test`
 * works without Docker. In CI a missing database is a failure: a silently
 * skipped schema suite is exactly how a migration that could not even be
 * applied reached the branch once already.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const hasSupabaseCredentials = Boolean(url && serviceRoleKey);

if (!hasSupabaseCredentials && process.env.CI) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in CI so the database suites run instead of skipping.',
  );
}

export const supabaseUrl = url ?? '';
export const supabaseServiceRoleKey = serviceRoleKey ?? '';
