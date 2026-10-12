/* ===== ParkEase shared code (loaded by index.html AND admin/index.html) =====
   OPTIONAL: paste your Supabase details to use the cloud database. Leave blank to use browser storage.
   Run supabase-setup.sql in Supabase first. Tables:
     slots(label, status, name, rate)            status: Available | Occupied   rate = fee per hour
     reservations(id, code, slot, username, hours, fee, method, paid, status, created_at, checkin_at, done_at)
                                                  status: Occupied | Completed | Cancelled   (paying makes it Occupied)
     waiting(id, name, created_at)
     users(username, full_name, password_hash, created_at)                                              */
const SB_URL = "";   // e.g. https://xxxx.supabase.co
const SB_KEY = "";   // anon public key
const ADMIN_PASS = "GROUP5";

/* ===== Fee settings ===== */
const DEFAULT_RATE = 20;      // pesos per hour for a new slot
const MAX_HOURS = 12;         // longest booking a user can make
const PAY_METHODS = ["GCash", "Credit / Debit card"];   // paying online makes the slot Occupied right away
const PAY_AT_GATE = "Pay at the gate";                  // old tickets only

const useSB = !!(SB_URL && SB_KEY);
let slots = [], queue = [], users = [], reservations = [];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const enc = encodeURIComponent;
const same = (a, b) => a && b && a.trim().toLowerCase() === b.trim().toLowerCase();
const peso = n => "₱" + Number(n || 0).toLocaleString("en-PH");
class UserErr extends Error {}               // a friendly warning, not a database failure

async function sb(path, method = "GET", body, prefer = "return=minimal") {
  const r = await fetch(SB_URL + "/rest/v1/" + path, { method,
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(await r.text());
  return (method === "GET" || prefer.includes("representation")) ? r.json() : null;
}
const dbPatchSlot = (s, oldLabel) => useSB && sb("slots?label=eq." + enc(oldLabel || s.label), "PATCH", { label: s.label, status: s.status, name: s.name, rate: s.rate });
const dbAddSlot = s => useSB && sb("slots", "POST", { label: s.label, status: s.status, name: s.name, rate: s.rate });
const dbDelSlot = l => useSB && sb("slots?label=eq." + enc(l), "DELETE");
const dbAddWait = n => useSB && sb("waiting", "POST", { name: n });
const dbDelWait = id => useSB && sb("waiting?id=eq." + id, "DELETE");
const dbAddUser = u => useSB && sb("users", "POST", { username: u.username, full_name: u.full_name, password_hash: u.pw });
const dbAddRes = r => useSB && sb("reservations", "POST", { code: r.code, slot: r.slot, username: r.username, hours: r.hours, fee: r.fee, method: r.method, paid: r.paid, status: r.status });
const dbPatchRes = r => useSB && sb("reservations?code=eq." + enc(r.code), "PATCH", { status: r.status, paid: r.paid, checkin_at: r.checkin_at || null, done_at: r.done_at || null });
async function dbClaim(s) {                  // only succeeds if the slot is STILL Available (stops two people booking the same slot)
  if (!useSB) return;
  const out = await sb("slots?label=eq." + enc(s.label) + "&status=eq.Available", "PATCH", { status: "Occupied", name: s.name }, "return=representation");
  if (!out.length) throw new UserErr("Sorry, that slot was just taken.");
}

async function load() {
  if (useSB) {
    slots = await sb("slots?select=*"); queue = await sb("waiting?select=*&order=id");
    users = await sb("users?select=username,full_name");                 // never loads password hashes
    reservations = await sb("reservations?select=*&order=id.desc");
  } else {
    const d = JSON.parse(localStorage.getItem("parkease") || "null");
    if (d) { slots = d.slots; queue = d.queue; reservations = d.reservations || []; }
    else {
      slots = ["A1","A2","A3","A4","A5","B1","B2","B3","VIP1","VIP2"].map(l => ({ label: l, status: "Available", name: null, rate: l.startsWith("VIP") ? 50 : DEFAULT_RATE }));
      queue = []; reservations = [];
    }
    users = JSON.parse(localStorage.getItem("parkease_users") || "[]");
  }
  slots.forEach(s => { s.rate = s.rate == null ? DEFAULT_RATE : Number(s.rate); if (s.status === "Reserved") s.status = "Occupied"; });   // old Reserved data counts as Occupied
  reservations.forEach(r => { r.fee = Number(r.fee); r.hours = Number(r.hours); if (r.status === "Reserved") r.status = "Occupied"; });
}
const save = () => localStorage.setItem("parkease", JSON.stringify({ slots, queue, reservations }));

/* Every change goes through persist(): reload fresh data -> run the change -> save -> redraw.
   The change function may return a message to show, or throw new UserErr("...") to warn the user. */
async function persist(fn) {
  let msg = "", ok = true;
  try { await load(); msg = await fn(); if (useSB) await load(); else save(); }
  catch (e) {
    ok = false; msg = e instanceof UserErr ? e.message : "Database error: " + String(e.message).slice(0, 90);
    try { await load(); } catch (_) {}
  }
  render(); if (msg) toast(msg);
  return ok;
}

/* ===== Data structure algorithms ===== */
const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
function linearSearch(arr, q, text = x => x.label) {   // linear search: scan first to last
  const out = []; q = q.trim().toLowerCase();
  for (let i = 0; i < arr.length; i++) if (text(arr[i]).toLowerCase().includes(q)) out.push(arr[i]);
  return out;
}
function bubbleSort(arr, key) {                        // bubble sort: swap neighbours until ordered
  const a = arr.slice();
  for (let i = 0; i < a.length - 1; i++)
    for (let j = 0; j < a.length - i - 1; j++) {
      const x = key === "status" ? a[j].status + a[j].label : a[j].label;
      const y = key === "status" ? a[j+1].status + a[j+1].label : a[j+1].label;
      if (nat(x, y) > 0) [a[j], a[j+1]] = [a[j+1], a[j]];
    }
  return a;
}
const sorted = () => bubbleSort(slots, "label");

/* ===== Reservation helpers ===== */
const isActive = r => r.status === "Occupied";
const activeRes = n => reservations.find(r => isActive(r) && same(r.username, n));
const resOfSlot = l => reservations.find(r => isActive(r) && r.slot === l);
const freeSlots = () => slots.filter(s => s.status === "Available");
function genCode() {                                   // ticket code like PE-7K3Q9X (no confusing 0/O/1/I)
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let c;
  do {
    const b = new Uint8Array(6); (window.crypto || { getRandomValues: a => a.forEach((_, i) => a[i] = Math.random() * 256) }).getRandomValues(b);
    c = "PE-" + [...b].map(x => A[x % A.length]).join("");
  } while (reservations.some(r => r.code === c));
  return c;
}
function payLabel(r) {
  if (r.status === "Cancelled") return r.paid ? "Refund due" : r.method === PAY_AT_GATE ? "—" : "Refunded";
  return r.paid ? "Paid" : "Unpaid";
}

/* ===== Accounts (lookups) ===== */
const userByName = n => users.find(u => same(u.username, n));
const fullName = n => userByName(n)?.full_name || n;
const adminName = n => userByName(n) ? userByName(n).full_name + " (@" + userByName(n).username + ")" : n;

/* ===== UI helpers ===== */
let tt; function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 3200); }
const closeDlg = id => $("#" + id).close();
function ago(iso) {
  if (!iso) return "—"; const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 1) return "just now"; if (m < 60) return m + " min ago";
  const h = Math.floor(m / 60); return h < 24 ? h + " hr ago" : Math.floor(h / 24) + " d ago";
}
const fmtTime = iso => iso ? new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—";
function counts() { const c = { Available: 0, Occupied: 0 }; slots.forEach(s => c[s.status] = (c[s.status] || 0) + 1); return c; }

/* keep the website and the admin page in sync */
window.addEventListener("storage", e => { if (!useSB && (e.key === "parkease" || e.key === "parkease_users")) load().then(() => render()); });
if (useSB) setInterval(() => {
  if (document.querySelector("dialog[open]") || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "")) return;
  load().then(() => render()).catch(() => {});
}, 15000);
