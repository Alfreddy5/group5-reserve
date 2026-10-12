/* ===== ParkEase admin dashboard. Shared code lives in common.js ===== */
let isAdmin = sessionStorage.getItem("pe_admin") === "1";
let tab = "overview", verified = null;

function adminLogin() {
  if ($("#pass").value.trim().toUpperCase() === ADMIN_PASS) { isAdmin = true; sessionStorage.setItem("pe_admin", "1"); $("#pass").value = ""; render(); }
  else toast("Wrong passcode.");
}
function adminLogout() { isAdmin = false; verified = null; sessionStorage.removeItem("pe_admin"); render(); }
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => { tab = b.dataset.t; showTab(); window.scrollTo(0, 0); });
function showTab() {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
  document.querySelectorAll(".content > section").forEach(s => s.classList.toggle("on", s.id === "t-" + tab));
}
const goTab = t => { tab = t; showTab(); };

/* ===== Reservation actions ===== */
function verifyCode() {
  let c = $("#vCode").value.trim().toUpperCase().replace(/\s/g, ""); if (!c) return toast("Type the ticket code first.");
  if (!c.startsWith("PE-")) c = "PE-" + c;
  verified = c; renderVerify();
}
function checkout(code) {                     // Occupied -> Completed, slot becomes Available
  persist(async () => {
    const r = reservations.find(x => x.code === code);
    if (!r || r.status !== "Occupied") throw new UserErr("That ticket is not checked in.");
    const s = slots.find(x => x.label === r.slot);
    r.status = "Completed"; r.done_at = new Date().toISOString();
    if (s) { s.status = "Available"; s.name = null; }
    await dbPatchRes(r); if (s) await dbPatchSlot(s);
    return "Slot " + r.slot + " checked out and Available again." + (queue.length ? " Next in the waiting list: " + fullName(queue[0].name) + "." : "");
  });
}
function cancelRes(code) {
  const r0 = reservations.find(x => x.code === code); if (!r0) return;
  if (!confirm("Cancel ticket " + code + " (slot " + r0.slot + ")?" + (r0.paid ? " It was paid, so mark the refund afterwards." : ""))) return;
  persist(async () => {
    const r = reservations.find(x => x.code === code);
    if (!r || !isActive(r)) throw new UserErr("That ticket is already closed.");
    const s = slots.find(x => x.label === r.slot);
    r.status = "Cancelled"; r.done_at = new Date().toISOString();
    if (s) { s.status = "Available"; s.name = null; }
    await dbPatchRes(r); if (s) await dbPatchSlot(s);
    return "Ticket cancelled, slot " + r.slot + " is Available." + (r.paid ? " Refund " + peso(r.fee) + " to the customer." : "");
  });
}
function markPaid(code) {
  persist(async () => { const r = reservations.find(x => x.code === code); if (!r) throw new UserErr("Ticket not found.");
    r.paid = true; await dbPatchRes(r); return peso(r.fee) + " marked as paid."; });
}
function markRefunded(code) {
  persist(async () => { const r = reservations.find(x => x.code === code); if (!r) throw new UserErr("Ticket not found.");
    r.paid = false; await dbPatchRes(r); return "Marked as refunded."; });
}
function resActions(r, long) {
  const c = esc(r.code); let h = "";
  if (r.status === "Occupied") {
    h += `<button class="btn sm g" onclick="checkout('${c}')">Check out</button>`;
    if (!r.paid) h += `<button class="btn sm l" onclick="markPaid('${c}')">Mark paid</button>`;   // old pay-at-gate tickets
  }
  if (isActive(r)) h += `<button class="btn sm r" onclick="cancelRes('${c}')">Cancel</button>`;
  if (r.status === "Cancelled" && r.paid) h += `<button class="btn sm l" onclick="markRefunded('${c}')">Mark refunded</button>`;
  return h || "—";
}

/* ===== Slot actions ===== */
const sections = () => [...new Set(slots.map(s => s.label.match(/^[A-Za-z]+/)?.[0]).filter(Boolean))];
function suggest() {
  const sec = $("#secNew").value.trim() || $("#secSel").value;
  const nums = slots.filter(s => s.label.startsWith(sec) && /^\d+$/.test(s.label.slice(sec.length))).map(s => +s.label.slice(sec.length));
  if (sec && !$("#secNew").value.trim()) $("#numIn").value = (nums.length ? Math.max(...nums) : 0) + 1;
  else if ($("#secNew").value.trim()) $("#numIn").value = "1";
}
function pickSection() {                      // choosing an existing section also fills its usual rate
  $("#secNew").value = ""; suggest();
  const s = slots.find(x => x.label.startsWith($("#secSel").value)); if (s) $("#rateIn").value = s.rate;
}
function addSlot() {
  const sec = ($("#secNew").value.trim() || $("#secSel").value || "").replace(/\s/g, "");
  const num = $("#numIn").value.trim().replace(/\s/g, ""), rate = parseFloat($("#rateIn").value);
  if (!sec || !num) return toast("Enter a section and a number/name.");
  if (!(rate >= 0)) return toast("Enter the rate per hour (0 or more).");
  const label = sec + num;
  persist(async () => {
    if (slots.some(s => s.label.toLowerCase() === label.toLowerCase())) throw new UserErr("Slot " + label + " already exists.");
    const s = { label, status: "Available", name: null, rate }; slots.push(s); await dbAddSlot(s);
    $("#secNew").value = ""; $("#numIn").value = "";
    return "Slot " + label + " added at " + peso(rate) + "/hr." + (queue.length ? " " + fullName(queue[0].name) + " (first in the waiting list) can reserve it." : "");
  });
}
function editSlot(label) {
  const s = slots.find(x => x.label === label); if (!s) return;
  const busy = !!resOfSlot(label);
  $("#sdBody").innerHTML = `<div class="form"><label for="sdLabel">Slot name</label><input id="sdLabel" value="${esc(s.label)}" maxlength="20" ${busy ? "disabled" : ""}>
    ${busy ? `<small class="sub" style="margin:0">This slot has an active ticket, so its name is locked.</small>` : ""}
    <label for="sdRate">Rate per hour (₱)</label><input id="sdRate" type="number" min="0" step="1" value="${s.rate}">
    <small class="sub" style="margin:0">A new rate only applies to future reservations.</small></div>
    <div class="row" style="margin:16px 0 0"><button class="btn" onclick="saveSlot('${esc(s.label)}')">Save changes</button><button class="btn l" onclick="closeDlg('slotDlg')">Cancel</button></div>`;
  $("#slotDlg").showModal();
}
function saveSlot(old) {
  const label = $("#sdLabel").value.trim().replace(/\s/g, ""), rate = parseFloat($("#sdRate").value);
  if (!label) return toast("The slot needs a name."); if (!(rate >= 0)) return toast("Enter a valid rate.");
  persist(async () => {
    const s = slots.find(x => x.label === old); if (!s) throw new UserErr("Slot not found.");
    if (label !== old) {
      if (resOfSlot(old)) throw new UserErr("Can't rename a slot that has an active ticket.");
      if (slots.some(x => x.label.toLowerCase() === label.toLowerCase())) throw new UserErr("Slot " + label + " already exists.");
    }
    s.label = label; s.rate = rate; await dbPatchSlot(s, old); return "Slot " + label + " updated.";
  }).then(ok => { if (ok) closeDlg("slotDlg"); });
}
function delSlot(l) {
  if (!confirm("Delete slot " + l + "?")) return;
  persist(async () => {
    if (resOfSlot(l)) throw new UserErr("Slot " + l + " has an active ticket. Cancel or check it out first.");
    slots = slots.filter(s => s.label !== l); await dbDelSlot(l); return "Slot deleted.";
  });
}
function releaseSlot(l) {                     // old slots taken before tickets existed have no ticket to check out
  persist(async () => { const s = slots.find(x => x.label === l); if (!s) throw new UserErr("Slot not found.");
    s.status = "Available"; s.name = null; await dbPatchSlot(s); return "Slot " + l + " released."; });
}
function removeQ(id) { persist(async () => { queue = queue.filter(q => q.id !== id); await dbDelWait(id); return "Removed from the waiting list."; }); }

/* ===== Rendering ===== */
function resRow(r, full) {
  return `<tr><td><b>${esc(r.code)}</b></td><td>${esc(r.slot)}</td><td>${esc(adminName(r.username))}</td><td>${r.hours}</td><td>${peso(r.fee)}</td>
    <td>${esc(r.method)}<br><span class="pill ${payLabel(r) === "Paid" ? "Paid" : payLabel(r) === "Unpaid" || payLabel(r) === "Refund due" ? "Pending" : "Completed"}">${payLabel(r)}</span></td>
    <td><span class="pill ${r.status}">${r.status}</span></td><td title="${esc(fmtTime(r.created_at))}">${ago(r.created_at)}</td><td class="acts">${resActions(r, full)}</td></tr>`;
}
function renderVerify() {
  const o = $("#vOut"); if (!verified) { o.innerHTML = ""; return; }
  const r = reservations.find(x => x.code === verified);
  if (!r) { o.innerHTML = `<div class="note bad" style="margin:14px 0 0">No ticket found for <b>${esc(verified)}</b>. Check the code and try again.</div>`; return; }
  o.innerHTML = `<div class="vcard"><div class="row" style="margin-bottom:8px"><b class="vcode">${esc(r.code)}</b><span class="pill ${r.status}">${r.status}</span></div>
    <div class="vgrid"><div><small>Customer</small><b>${esc(adminName(r.username))}</b></div><div><small>Slot</small><b>${esc(r.slot)}</b></div>
    <div><small>Duration</small><b>${r.hours} hr${r.hours > 1 ? "s" : ""}</b></div><div><small>Fee</small><b>${peso(r.fee)} · ${payLabel(r)}</b></div></div>
    <div class="row" style="margin:12px 0 0">${resActions(r, true)}</div></div>`;
}
function renderOverview() {
  const c = counts(), live = reservations.filter(r => r.status !== "Cancelled");
  const earned = live.filter(r => r.paid).reduce((a, r) => a + r.fee, 0), owed = live.filter(r => !r.paid).reduce((a, r) => a + r.fee, 0);
  $("#astats").innerHTML = `<div class="stat"><b>${slots.length}</b><span>Total slots</span></div><div class="stat"><b>${c.Available}</b><span>Available</span></div>
    <div class="stat"><b>${c.Occupied}</b><span>Occupied</span></div>
    <div class="stat"><b>${queue.length}</b><span>Waiting</span></div><div class="stat"><b>${users.length}</b><span>Users</span></div>
    <div class="stat"><b>${peso(earned)}</b><span>Collected</span></div><div class="stat"><b>${peso(owed)}</b><span>Still to collect</span></div>`;
  const pend = reservations.filter(r => r.status === "Occupied");
  $("#aPending").innerHTML = pend.length ? `<div class="tbl"><table><thead><tr><th>Code</th><th>Slot</th><th>Customer</th><th>Hours</th><th>Fee</th><th>Payment</th><th>Status</th><th>Booked</th><th>Actions</th></tr></thead><tbody>${pend.map(r => resRow(r, false)).join("")}</tbody></table></div>`
    : '<div class="empty">Nobody is parked right now.</div>';
  renderVerify();
}
function renderRes() {
  const f = $("#rFilter").value, q = $("#rq").value;
  let list = reservations;
  if (q.trim()) { const hit = linearSearch(reservations, q, r => [r.code, r.slot, r.username, fullName(r.username)].join(" ")); list = list.filter(r => hit.includes(r)); }
  if (f) list = list.filter(r => r.status === f);
  $("#rBody").innerHTML = list.map(r => resRow(r, false)).join("") || '<tr><td colspan="9" class="empty">No reservations found.</td></tr>';
}
function renderSlots() {
  const cur = $("#secSel").value;
  $("#secSel").innerHTML = sections().map(s => `<option ${s === cur ? "selected" : ""}>${esc(s)}</option>`).join("");
  if (!$("#numIn").value) suggest();
  if (!$("#rateIn").value) $("#rateIn").value = DEFAULT_RATE;
  let list = bubbleSort(slots, $("#sortBy").value);
  const q = $("#q").value; if (q.trim()) { const hit = linearSearch(slots, q); list = list.filter(s => hit.includes(s)); }
  $("#sBody").innerHTML = list.map(s => { const r = resOfSlot(s.label), l = esc(s.label);
    return `<tr><td><b>${l}</b></td><td>${peso(s.rate)}</td><td><span class="pill ${s.status}">${s.status}</span></td><td>${s.name ? esc(adminName(s.name)) : "—"}</td><td>${r ? esc(r.code) : "—"}</td>
    <td class="acts"><button class="btn sm l" onclick="editSlot('${l}')">Edit</button>${s.status !== "Available" && !r ? `<button class="btn sm l" onclick="releaseSlot('${l}')">Release</button>` : ""}<button class="btn sm r" onclick="delSlot('${l}')">Delete</button></td></tr>`; }).join("")
    || '<tr><td colspan="6" class="empty">Slot not found.</td></tr>';
}
function renderWait() {
  $("#aWait").innerHTML = queue.length ? queue.map((x, i) => `<div class="q"><div class="num">${i + 1}</div><b style="flex:1">${esc(adminName(x.name))}</b>
    ${i < freeSlots().length ? '<span class="pill Available">Can reserve now</span>' : ""}<button class="btn sm r" onclick="removeQ(${x.id})">Remove</button></div>`).join("") : '<div class="empty">Waiting list is empty.</div>';
}
function renderUsers() {
  $("#aUsers").innerHTML = users.length ? users.map(u => { const r = activeRes(u.username);
    return `<div class="q"><div class="num">${esc(u.full_name.charAt(0).toUpperCase())}</div><b style="flex:1">${esc(u.full_name)}</b>${r ? `<span class="pill ${r.status}">${esc(r.slot)} · ${r.status}</span>` : ""}<span class="sub" style="margin:0">@${esc(u.username)}</span></div>`; }).join("") : '<div class="empty">No registered users yet.</div>';
}
function render() {
  $("#gate").style.display = isAdmin ? "none" : "flex"; $("#shell").style.display = isAdmin ? "grid" : "none";
  $("#mode").textContent = useSB ? "· cloud" : "· local demo";
  if (!isAdmin) return;
  $("#bWait").textContent = queue.length || "";
  renderOverview(); renderRes(); renderSlots(); renderWait(); renderUsers(); showTab();
}
load().then(render).catch(e => { render(); toast("Could not load data: " + e.message.slice(0, 80)); });
