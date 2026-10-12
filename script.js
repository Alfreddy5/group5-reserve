/* ===== ParkEase website (users). Shared code lives in common.js ===== */
let me = localStorage.getItem("pe_user") || null;      // username of the logged-in user
let resTarget = null;                                   // slot currently being reserved

/* ===== Accounts ===== */
async function hashPw(u, p) {
  const s = "parkease:" + u + ":" + p;
  if (window.crypto && crypto.subtle) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0;   // fallback when crypto is unavailable
  return "f" + (h >>> 0).toString(16);
}
function authTab(t) {
  $("#fLogin").style.display = t === "login" ? "grid" : "none";
  $("#fSignup").style.display = t === "signup" ? "grid" : "none";
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.t === t));
}
function openAuth(t) { authTab(t); go("auth"); }
function loginAs(un) {
  me = un; localStorage.setItem("pe_user", un);
  ["#liUser", "#liPass", "#suName", "#suUser", "#suPass", "#suPass2"].forEach(i => $(i).value = "");
  render(); go("mine"); toast("Welcome, " + fullName(un) + "!");
}
async function signup() {
  const full = $("#suName").value.trim(), un = $("#suUser").value.trim().toLowerCase(), pw = $("#suPass").value, pw2 = $("#suPass2").value;
  if (!full || !un || !pw) return toast("Please fill in every field.");
  if (!/^[a-z0-9_]{3,20}$/.test(un)) return toast("Username: 3-20 letters, numbers or _ only.");
  if (pw.length < 4) return toast("Password must be at least 4 characters.");
  if (pw !== pw2) return toast("Passwords do not match.");
  try { await load(); } catch (e) { return toast("Could not load data: " + e.message.slice(0, 80)); }
  if (userByName(un)) return toast("That username is already taken.");
  const u = { username: un, full_name: full, pw: await hashPw(un, pw) };
  try {
    if (useSB) await dbAddUser(u);
    users.push(useSB ? { username: un, full_name: full } : u);
    if (!useSB) localStorage.setItem("parkease_users", JSON.stringify(users));
  } catch (e) { return toast(/duplicate|23505|409/.test(e.message) ? "That username is already taken." : "Database error: " + e.message.slice(0, 80)); }
  loginAs(un);
}
async function login() {
  const un = $("#liUser").value.trim().toLowerCase(), pw = $("#liPass").value;
  if (!un || !pw) return toast("Enter your username and password.");
  const h = await hashPw(un, pw); let ok = false;
  try {
    if (useSB) { const r = await sb("users?username=eq." + enc(un) + "&select=password_hash"); ok = r.length > 0 && r[0].password_hash === h; }
    else { const u = users.find(x => x.username === un); ok = !!u && u.pw === h; }
  } catch (e) { return toast("Database error: " + e.message.slice(0, 80)); }
  if (!ok) return toast("Wrong username or password.");
  if (!userByName(un)) await load();
  loginAs(un);
}
function userLogout() { me = null; localStorage.removeItem("pe_user"); render(); go("home"); toast("Logged out."); }

/* ===== Navigation ===== */
function go(p) { document.querySelectorAll("main > section").forEach(s => s.classList.toggle("on", s.id === p));
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.p === p)); window.scrollTo(0, 0); }
document.querySelectorAll("#nav button").forEach(b => b.onclick = () => go(b.dataset.p));
function needLogin() { toast("Please log in or sign up first."); openAuth("login"); }

/* ===== Reserving a slot (fee + ticket code) ===== */
// Free slots go to the waiting list first: the first N people in line may take the N free slots.
function eligible() {
  const n = freeSlots().length; if (!n) return false;
  if (!queue.length) return true;
  const i = queue.findIndex(q => same(q.name, me));
  return i >= 0 && i < n;
}
function heldMsg() { return queue.some(q => same(q.name, me)) ? "Free slots are held for people ahead of you in the waiting list." : "Free slots are held for the waiting list first."; }

function openReserve(label) {
  if (!me) return needLogin();
  if (activeRes(me)) return toast("You already have a parking slot. One per person.");
  const s = slots.find(x => x.label === label); if (!s || s.status !== "Available") return toast("Sorry, that slot was just taken.");
  if (!eligible()) return toast(heldMsg());
  resTarget = { label: s.label, rate: s.rate };
  $("#rdTitle").textContent = "Pay for slot " + s.label;
  $("#rdBody").innerHTML = `<p class="sub" style="margin-bottom:14px">Rate: <b>${peso(s.rate)}</b> per hour</p>
    <div class="form"><label for="rdHours">How long will you park?</label>
    <select id="rdHours" onchange="rdUpdate()">${Array.from({ length: MAX_HOURS }, (_, i) => `<option value="${i + 1}">${i + 1} hour${i ? "s" : ""}</option>`).join("")}</select>
    <label for="rdPay">Payment method</label>
    <select id="rdPay" onchange="rdUpdate()">${PAY_METHODS.map(m => `<option>${esc(m)}</option>`).join("")}</select></div>
    <div class="feebox"><span>Total fee</span><b id="rdFee"></b></div>
    <p class="sub" id="rdNote" style="font-size:.85rem;margin-bottom:16px"></p>
    <div class="row" style="margin:0"><button class="btn" onclick="confirmReserve()">Pay now</button><button class="btn l" onclick="closeDlg('resDlg')">Cancel</button></div>`;
  rdUpdate(); $("#resDlg").showModal();
}
function rdUpdate() {
  const h = +$("#rdHours").value;
  $("#rdFee").textContent = peso(resTarget.rate * h);
  $("#rdNote").textContent = "Demo payment: no real money is charged. As soon as you pay, the slot is yours and shows as Occupied.";
}
async function confirmReserve() {
  const label = resTarget.label, hours = +$("#rdHours").value, method = $("#rdPay").value;
  if (!(hours >= 1 && hours <= MAX_HOURS)) return toast("Choose between 1 and " + MAX_HOURS + " hours.");
  let made = null;
  const ok = await persist(async () => {
    if (activeRes(me)) throw new UserErr("You already have a parking slot. One per person.");
    const s = slots.find(x => x.label === label); if (!s || s.status !== "Available") throw new UserErr("Sorry, that slot was just taken.");
    if (!eligible()) throw new UserErr(heldMsg());
    const now = new Date().toISOString();
    const r = { code: genCode(), slot: s.label, username: me, hours, fee: s.rate * hours, method, paid: true, status: "Occupied", created_at: now, checkin_at: now };
    s.status = "Occupied"; s.name = me;
    await dbClaim(s);                         // fails if someone else grabbed the slot first
    reservations.unshift(r); await dbAddRes(r);
    const qi = queue.findIndex(q => same(q.name, me));
    if (qi >= 0) { const q = queue.splice(qi, 1)[0]; await dbDelWait(q.id); }
    made = r.code; return "";
  });
  closeDlg("resDlg"); if (ok && made) showTicket(made);
}

/* ===== Ticket ===== */
function ticketHTML(r, withCancel) {
  const note = r.status === "Occupied"
    ? `Payment received. Slot <b>${esc(r.slot)}</b> is yours and shows as Occupied. Show this code to the parking attendant if asked.${r.paid ? "" : ` Please pay <b>${peso(r.fee)}</b> at the gate.`}`
    : r.status === "Completed" ? "This parking session is finished." : "This ticket was cancelled.";
  return `<div class="ticketwrap"><div class="ticket">
    <div class="th"><span>ParkEase parking ticket</span><span class="pill ${r.status}">${r.status}</span></div>
    <div class="tcode">${esc(r.code)}</div>
    <div class="tgrid"><div><small>Slot</small><b>${esc(r.slot)}</b></div><div><small>Duration</small><b>${r.hours} hr${r.hours > 1 ? "s" : ""}</b></div>
      <div><small>Fee</small><b>${peso(r.fee)}</b></div><div><small>Payment</small><b>${esc(r.method)} · ${payLabel(r)}</b></div></div>
    <p class="tnote">${note}</p><small class="tnote">Booked ${fmtTime(r.created_at)}</small></div>
    <div class="row noprint" style="margin:12px 0 0"><button class="btn sm" onclick="copyCode('${esc(r.code)}')">Copy code</button>
    <button class="btn l sm" onclick="printTicket(this)">Print ticket</button>
    ${withCancel && r.status === "Occupied" ? `<button class="btn r sm" onclick="leaveSlot('${esc(r.code)}')">Leave slot</button>` : ""}</div></div>`;
}
function showTicket(code) {
  const r = reservations.find(x => x.code === code); if (!r) return;
  $("#tkBody").innerHTML = `<p class="sub" style="margin-bottom:14px">Payment received. Slot is yours. Keep this code as your parking ticket.</p>` + ticketHTML(r, false)
    + `<div class="row noprint" style="margin:14px 0 0"><button class="btn l" onclick="closeDlg('tkDlg');go('mine')">View in My Account</button></div>`;
  $("#tkDlg").showModal();
}
function copyCode(c) {
  (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(() => toast("Code " + c + " copied."), () => toast("Your code is " + c));
}
function printTicket(btn) {
  const t = btn.closest(".ticketwrap").querySelector(".ticket"); t.classList.add("printme"); window.print(); t.classList.remove("printme");
}
function leaveSlot(code) {                   // the user is leaving: ticket completed, slot Available (no refund)
  const r0 = reservations.find(x => x.code === code); if (!r0) return;
  if (!confirm("Leave slot " + r0.slot + "? Your paid time ends now and the fee is not refunded.")) return;
  persist(async () => {
    const r = reservations.find(x => x.code === code);
    if (!r || !same(r.username, me)) throw new UserErr("Ticket not found.");
    if (r.status !== "Occupied") throw new UserErr("This ticket is already closed.");
    const s = slots.find(x => x.label === r.slot);
    r.status = "Completed"; r.done_at = new Date().toISOString();
    if (s) { s.status = "Available"; s.name = null; }
    await dbPatchRes(r); if (s) await dbPatchSlot(s);
    return "You left slot " + r.slot + "." + (queue.length ? " " + fullName(queue[0].name) + " is next in the waiting list." : "");
  });
}

/* ===== Waiting list ===== */
function joinQueue() {
  if (!me) return needLogin();
  persist(async () => {
    if (freeSlots().length > queue.length) throw new UserErr("Slots are still available, no need to wait!");
    if (activeRes(me) || queue.some(q => same(q.name, me))) throw new UserErr("You already have a slot or a place in line.");
    queue.push({ id: Date.now(), name: me }); await dbAddWait(me); return "Added to the waiting list.";
  });
}
function leaveQueue(id) {
  persist(async () => { queue = queue.filter(q => q.id !== id); await dbDelWait(id); return "You left the waiting list."; });
}

/* ===== Rendering ===== */
function authLinks() { return `<button class="link" onclick="openAuth('login')">Log in</button> or <button class="link" onclick="openAuth('signup')">sign up</button>`; }
function renderMine() {
  const o = $("#mineOut"), u = me && userByName(me);
  if (!u) { o.innerHTML = `<div class="empty">Log in to see your profile, ticket and parking status.<br><br><button class="btn" onclick="openAuth('login')">Log in</button> <button class="btn l" onclick="openAuth('signup')">Sign up</button></div>`; return; }
  const r = activeRes(u.username), qi = queue.findIndex(q => same(q.name, u.username));
  let st;
  if (r) st = ticketHTML(r, true);
  else if (qi >= 0) st = `<div class="empty" style="padding-left:0;text-align:left">⏳ You're <b>#${qi + 1}</b> in the waiting list. ${qi < freeSlots().length ? "A slot is open for you. <button class='link' onclick=\"go('slots')\">Take it now</button>." : "You get first pick when a slot frees up."}</div><button class="btn r" onclick="leaveQueue(${queue[qi].id})">Leave waiting list</button>`;
  else st = `<div class="empty" style="padding-left:0;text-align:left">You don't have a parking slot yet.</div><button class="btn" onclick="go('slots')">View parking slots</button>`;
  const past = reservations.filter(x => same(x.username, u.username) && !isActive(x));
  const hist = past.length ? `<h3 style="margin:26px 0 8px">Past tickets</h3><div class="tbl"><table><thead><tr><th>Code</th><th>Slot</th><th>Hours</th><th>Fee</th><th>Status</th><th>Booked</th></tr></thead><tbody>${
    past.map(x => `<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.slot)}</td><td>${x.hours}</td><td>${peso(x.fee)}</td><td><span class="pill ${x.status}">${x.status}</span></td><td>${fmtTime(x.created_at)}</td></tr>`).join("")}</tbody></table></div>` : "";
  o.innerHTML = `<div class="profile"><div class="avatar">${esc(u.full_name.charAt(0).toUpperCase())}</div><div><b style="font-size:1.1rem">${esc(u.full_name)}</b><br><span class="sub" style="margin:0">@${esc(u.username)}</span></div>
    <button class="btn l sm" style="margin-left:auto" onclick="userLogout()">Log out</button></div><h3 style="margin:0 0 8px">Your parking</h3>` + st + hist;
}
function render() {
  const c = counts(), logged = me && userByName(me);
  $("#mode").textContent = useSB ? "· cloud" : "· local demo";
  $("#who").innerHTML = logged
    ? `<button class="hb" onclick="go('mine')">👤 ${esc(fullName(me))}</button><button class="hb" onclick="userLogout()">Log out</button>`
    : `<button class="hb" onclick="openAuth('login')">Log in</button><button class="hb on" onclick="openAuth('signup')">Sign up</button>`;
  $("#heroBtns").innerHTML = `<button class="btn" onclick="go('slots')">View Parking Slots</button><button class="btn l" onclick="go('wait')">Check Waiting List</button>` + (me ? "" : `<button class="btn l" onclick="openAuth('signup')">Create account</button>`);
  const rates = slots.map(s => s.rate);
  $("#stats").innerHTML = `<div class="stat"><b>${c.Available}</b><span>Available</span></div>
    <div class="stat"><b>${c.Occupied}</b><span>Occupied</span></div><div class="stat"><b>${queue.length}</b><span>Waiting</span></div>
    <div class="stat"><b>${rates.length ? peso(Math.min(...rates)) : "—"}</b><span>Per hour, from</span></div>`;

  const can = logged && eligible();
  $("#slotNote").innerHTML = logged
    ? `<div class="note ok">Logged in as <b>${esc(fullName(me))}</b>. Tap a green slot and pay the fee. The slot becomes <b>Occupied</b> right away and you get a ticket code.</div>`
      + (freeSlots().length && !can && !activeRes(me) ? `<div class="note">${heldMsg()}</div>` : "")
    : `<div class="note">You need an account to take a slot. ${authLinks()}.</div>`;
  $("#grid").innerHTML = sorted().map(s => { const mine = me && s.status !== "Available" && same(s.name, me);
    const sub = s.status === "Available" ? (logged && !can && !activeRes(me) ? "Held for waiting list" : "Tap to park") : mine ? s.status + " · You" : s.status;
    return `<div class="slot ${s.status}${mine ? " mine" : ""}" ${s.status === "Available" ? `onclick="openReserve('${esc(s.label)}')"` : ""}><b>${esc(s.label)}</b><small>${sub}</small><small class="rate">${peso(s.rate)}/hr</small></div>`; }).join("") || '<div class="empty">No slots yet.</div>';

  const n = freeSlots().length;
  $("#joinBtn").disabled = n > queue.length;
  $("#waitNote").innerHTML = logged ? "" : `<div class="note">You need an account to join the waiting list. ${authLinks()}.</div>`;
  const myQ = logged ? queue.findIndex(q => same(q.name, me)) : -1;
  $("#waitOut").innerHTML = (myQ >= 0 && myQ < n ? `<div class="note ok">🎉 A slot is open for you. <button class="link" onclick="go('slots')">Take it now</button></div>` : "")
    + (n > queue.length ? '<div class="empty">Slots are available right now. <a href="#" onclick="go(\'slots\');return false">Take one</a></div>' : "")
    + (queue.length ? queue.map((q, i) => `<div class="q"><div class="num">${i + 1}</div><b>${esc(fullName(q.name))}</b></div>`).join("") : '<div class="empty">Nobody is waiting.</div>');
  renderMine();
}
load().then(() => { if (me && !userByName(me)) { me = null; localStorage.removeItem("pe_user"); } render(); })
  .catch(e => toast("Could not load data: " + e.message.slice(0, 80)));
