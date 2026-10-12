// Mutating integration suites may only reach a disposable loopback Supabase stack.
export function isolatedSupabaseEnvironment(env = process.env) {
  if (!env.MALI_TEST_SUPABASE_URL || !env.MALI_TEST_SUPABASE_ANON_KEY) {
    throw new Error('Set MALI_TEST_SUPABASE_URL and MALI_TEST_SUPABASE_ANON_KEY for an isolated local Supabase stack.');
  }
  const url = new URL(env.MALI_TEST_SUPABASE_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Mutating tests refuse non-loopback endpoints, including production.');
  }
  return { url: url.origin, anonKey: env.MALI_TEST_SUPABASE_ANON_KEY };
}
