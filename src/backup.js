const DB_NAME = 'cjk_backup';
const STORE = 'snapshots';
const LAST_DL = 'cjk_backup_last_download';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function snapshot() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    data[k] = localStorage.getItem(k);
  }
  return data;
}

export async function saveBackup() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snapshot(), 'latest');
    tx.objectStore(STORE).put(new Date().toISOString(), 'timestamp');
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
  } catch {}
}

export async function loadBackup() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const data = await new Promise(r => { const req = store.get('latest'); req.onsuccess = () => r(req.result); req.onerror = () => r(null); });
    const ts = await new Promise(r => { const req = store.get('timestamp'); req.onsuccess = () => r(req.result); req.onerror = () => r(null); });
    return data ? { data, timestamp: ts } : null;
  } catch { return null; }
}

export async function restoreFromBackup() {
  const backup = await loadBackup();
  if (!backup) return false;
  Object.entries(backup.data).forEach(([k, v]) => localStorage.setItem(k, v));
  return true;
}

export function downloadBackup() {
  const data = snapshot();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const d = new Date();
  const name = `CJK_Backup_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 2000);
  localStorage.setItem(LAST_DL, Date.now().toString());
}

export function restoreFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (typeof data !== 'object' || data === null) throw new Error('bad format');
        Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
        resolve(true);
      } catch { reject(new Error('Invalid backup file')); }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}

export function checkWeeklyDownload() {
  const last = parseInt(localStorage.getItem(LAST_DL) || '0', 10);
  return Date.now() - last >= WEEK_MS;
}

export async function checkAndRestore() {
  const hasData = localStorage.getItem('cjk_payroll_staff_v3');
  if (hasData) return false;
  const backup = await loadBackup();
  if (!backup) return false;
  return 'available';
}
