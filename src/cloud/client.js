// ─── Supabase client (feature-flagged) ───
// Cloud sync only turns on when BOTH env vars are present at build time:
//   VITE_SUPABASE_URL       — the project URL (Settings → API)
//   VITE_SUPABASE_ANON_KEY  — the anon/public key (safe to ship in the bundle)
// With neither set, `cloudEnabled` is false and the whole app behaves exactly
// as it always has: localStorage-only, no login. So this file is inert until
// Owen wires the keys into Vercel + a local .env.
import { createClient } from '@supabase/supabase-js';

const URL  = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const cloudEnabled = Boolean(URL && ANON);

// Single shared table that mirrors localStorage: one row per key.
export const STORE_TABLE = 'app_store';

// supabase-js persists the auth session in localStorage under an `sb-*` key and
// refreshes it automatically, so the shared login survives refreshes.
export const supabase = cloudEnabled
  ? createClient(URL, ANON, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
