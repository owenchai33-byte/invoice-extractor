// ─── localStorage ⇄ Supabase sync ───
// Strategy: keep localStorage as the app's working store (offline-capable, zero
// change to any payroll/invoice logic). Mirror every relevant key to one
// `app_store` row. Pull on load (before the app renders), push on every save.
// Last-write-wins per key — fine for two low-frequency users; simultaneous edits
// to the *same* key are rare and the loser just needs a reload.
import { supabase, cloudEnabled, STORE_TABLE } from './client';

// Never sync: the Anthropic API key (a secret — stays on-device) and supabase's
// own auth-session keys (sb-*). Everything else (payroll, invoices, contracts,
// batches, UI state) mirrors up.
const skip = (key) => !key || key === 'anthropic_api_key' || key.startsWith('sb-');

let applyingRemote = false;      // true while we write cloud→local, so we don't echo back up
const timers = {};

function debouncePush(key, value) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => pushKey(key, value), 500);
}

async function pushKey(key, value) {
  try {
    await supabase.from(STORE_TABLE).upsert({ key, value, updated_at: new Date().toISOString() });
  } catch (e) { console.warn('[cloud] push failed:', key, e?.message || e); }
}

// Pull every row and write it into localStorage verbatim (values are stored as
// the exact localStorage string, so the round-trip is lossless).
export async function pullAll() {
  const { data, error } = await supabase.from(STORE_TABLE).select('key,value');
  if (error) { console.warn('[cloud] pull failed:', error.message); return { count: 0, error }; }
  applyingRemote = true;
  try {
    for (const row of data) {
      if (row.value != null) window.localStorage.setItem(row.key, row.value);
    }
  } finally { applyingRemote = false; }
  return { count: data.length };
}

// Push this device's whole localStorage up — used to seed an empty cloud.
export async function migrateLocalUp() {
  const now = new Date().toISOString();
  const rows = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (skip(key)) continue;
    rows.push({ key, value: localStorage.getItem(key), updated_at: now });
  }
  if (!rows.length) return { count: 0 };
  const { error } = await supabase.from(STORE_TABLE).upsert(rows);
  if (error) { console.warn('[cloud] migrate failed:', error.message); return { count: 0, error }; }
  return { count: rows.length };
}

// Patch localStorage.setItem so every future write also mirrors to the cloud.
let mirrorInstalled = false;
function installWriteMirror() {
  if (mirrorInstalled) return;
  mirrorInstalled = true;
  const ls = window.localStorage;
  const orig = ls.setItem.bind(ls);
  ls.setItem = (key, value) => {
    orig(key, value);
    if (!applyingRemote && !skip(key)) debouncePush(String(key), String(value));
  };
}

// Does this device actually hold real CJK data? Guards against a fresh/empty
// device (e.g. a localhost test origin, or a brand-new browser) seeding the
// cloud with nothing — which would then overwrite everyone else's real data.
// Only a device that has real payroll/invoice data may seed an empty cloud.
function localHasRealData() {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith('cjk_payroll_staff') || k.startsWith('choonhua_invoices') || k.startsWith('yhs_')) {
      const v = localStorage.getItem(k);
      if (v && v.length > 2) return true;   // non-empty array/object
    }
  }
  return false;
}

// Boot sequence, run once after the user is authenticated and before the app
// renders:
//   cloud has data        → pull it down (cloud is the source of truth)
//   cloud empty + we have data → seed the cloud from this device
//   cloud empty + no data → do nothing (never seed an empty/test device)
// Then install the write-mirror so future saves push up.
export async function cloudBoot() {
  if (!cloudEnabled) return { mode: 'off' };
  let mode = 'pull';
  try {
    const { count, error } = await supabase
      .from(STORE_TABLE).select('*', { count: 'exact', head: true });
    if (error) throw error;
    if (count) { await pullAll(); mode = 'pull'; }
    else if (localHasRealData()) { await migrateLocalUp(); mode = 'seed'; }
    else { mode = 'empty'; }
  } catch (e) {
    console.warn('[cloud] boot failed, staying on local data:', e?.message || e);
    mode = 'error';
  }
  installWriteMirror();
  return { mode };
}
