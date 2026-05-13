import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy init for both clients so module load doesn't crash when env vars
// are missing (e.g. during `next build` on a fresh checkout without
// .env.local — Vercel build has env injected, local doesn't).

let _browser: SupabaseClient | null = null;
let _service: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_browser) {
    _browser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _browser;
}

export function createServiceClient(): SupabaseClient {
  if (!_service) {
    _service = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return _service;
}

// Backwards-compatible export — some pages may import { supabase } directly.
// Use a Proxy that defers creation until first method call.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
