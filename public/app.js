const $ = (sel) => document.querySelector(sel);
const app = $("#app");
const state = {
  me: null,
  locked: true,
  session: null,
  syncedAt: null,
  ageBand: "never",
  neverSynced: true,
  patient: null,
  lines: [],
  referringDoctor: null,
  reasons: [],
  bills: [],
  receipt: null,
  counts: { serviceCount: 0, doctorCount: 0, patientCount: 0, staffCount: 0 },
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function fmt(n) { return "₹" + Number(n || 0).toLocaleString("en-IN"); }
function syncedLabel() {
  if (!state.syncedAt || state.neverSynced || state.ageBand === "never") {
    return "No doctors/tests on this stick yet. Super admin: CARE → Settings → Emergency Billing → Download USB seed. Copy seed files here, or upload them after login.";
  }
  const d = new Date(state.syncedAt);
  const when = d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  if (state.ageBand === "stale") {
    return "Tariff / master data last synchronized: " + when + " — STALE (older than 24 hours). Billing still uses this last valid snapshot.";
  }
  if (state.ageBand === "warning") {
    return "Tariff / master data last synchronized: " + when + " — snapshot is more than 6 hours old. Push from CARE when the main NAS is reachable.";
  }
  return "Tariff / master data last synchronized: " + when;
}

function syncBannerClass() {
  if (!state.syncedAt || state.ageBand === "never") return "lock";
  if (state.ageBand === "stale") return "stale";
  if (state.ageBand === "warning") return "warn";
  return "ok";
}

function render() {
  if (!state.me) return renderLogin();
  renderMain();
}

function renderLogin() {
  app.innerHTML = `
    <div class="wrap">
      <div class="card">
        <h1>CARE Ultra-Emergency (USB)</h1>
        <p class="muted">Pendrive capture only — use when CARE and DS225+ are both down. Import the CSV into CARE when it is back.</p>
        <div class="banner ${state.locked ? "lock" : "ok"}">${state.locked ? "EMERGENCY BILLING LOCKED" : "Emergency session ACTIVE"}</div>
        <p class="banner ${syncBannerClass()}">${syncedLabel()}</p>
        <form id="login">
          <label>Username</label>
          <input name="username" autocomplete="username" required />
          <label>PIN</label>
          <input name="pin" type="password" autocomplete="current-password" required />
          <div class="row" style="margin-top:12px"><button type="submit">Login</button></div>
          <p class="muted">If this stick was never seeded from CARE, login <b>owner</b> / PIN <b>1234</b> then upload tests + doctors.</p>
          <p id="err" class="muted"></p>
        </form>
      </div>
    </div>`;
  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/login", { method: "POST", body: { username: fd.get("username"), pin: fd.get("pin") } });
      await boot();
    } catch (err) { $("#err").textContent = err.message; }
  };
}

function renderMain() {
  const admin = state.me.role === "admin" || state.me.role === "super_admin";
  app.innerHTML = `
    <div class="wrap">
      <div class="row" style="justify-content:space-between">
        <div>
          <h1>CARE Ultra-Emergency (USB)</h1>
          <div class="muted">${state.me.name} · ${state.me.role} · 127.0.0.1 only</div>
        </div>
        <div class="row">
          ${admin && state.locked ? `<button id="start">START EMERGENCY SESSION</button>` : ""}
          ${admin && !state.locked ? `<button id="end" class="secondary">END EMERGENCY SESSION</button>` : ""}
          ${admin ? `<button id="csv" class="secondary">Download CSV for CARE</button><button id="json" class="secondary">Download JSON</button>` : ""}
          <button id="logout" class="secondary">Logout</button>
        </div>
      </div>
      <div class="banner ${state.locked ? "lock" : "ok"}">${state.locked ? "EMERGENCY BILLING LOCKED" : "SESSION ACTIVE — reception may bill"}</div>
      <div class="banner ${syncBannerClass()}">${syncedLabel()}</div>
      ${admin ? seedPanel() : ""}
      ${state.locked ? `<div class="card">Ask the owner to start an emergency session after tests are loaded. Reception cannot unlock this screen.</div>` : billForm()}
      <div class="card">
        <h2>Today's emergency bills</h2>
        <div id="bills"></div>
      </div>
      <div id="receipt" class="receipt hidden"></div>
    </div>`;
  $("#logout").onclick = async () => { await api("/api/logout", { method: "POST" }); state.me = null; render(); };
  if ($("#start")) $("#start").onclick = startSession;
  if ($("#end")) $("#end").onclick = endSession;
  if ($("#csv")) $("#csv").onclick = () => download("/api/export/csv", "CARE_EMERGENCY_BILLING_V1.csv");
  if ($("#json")) $("#json").onclick = () => download("/api/export/json", "CARE_EMERGENCY_BILLING_JSON_V1.json");
  if (admin) bindSeedPanel();
  if (!state.locked) bindBillForm();
  renderBills();
}

function seedPanel() {
  const c = state.counts || {};
  return `
    <div class="card">
      <h2>USB seed (doctors + tests)</h2>
      <p class="muted">From CARE super admin: Download USB seed zip, copy <code>seed/</code> onto this stick, then reload. Or upload files here. This is not a bill import.</p>
      <div class="muted">Loaded: ${c.serviceCount || 0} tests · ${c.doctorCount || 0} doctors · ${c.staffCount || 0} staff</div>
      <div class="grid" style="margin-top:8px">
        <div>
          <label>CARE_EMERGENCY_MASTER_V1.json</label>
          <input id="seedjson" type="file" accept=".json,application/json" />
        </div>
        <div>
          <label>tests.csv</label>
          <input id="seedtests" type="file" accept=".csv,text/csv" />
        </div>
        <div>
          <label>doctors.csv</label>
          <input id="seeddocs" type="file" accept=".csv,text/csv" />
        </div>
      </div>
      <p id="seederr" class="muted"></p>
    </div>`;
}

function bindSeedPanel() {
  const readText = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsText(file);
  });
  const show = (msg) => { const el = $("#seederr"); if (el) el.textContent = msg; };
  if ($("#seedjson")) $("#seedjson").onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const snapshot = JSON.parse(await readText(f));
      const r = await api("/api/seed/master", { method: "POST", body: snapshot });
      show(`Master loaded: ${r.serviceCount} tests, ${r.doctorCount} doctors`);
      await boot();
    } catch (err) { show(err.message); }
  };
  if ($("#seedtests")) $("#seedtests").onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const r = await api("/api/seed/tests-csv", { method: "POST", body: { csv: await readText(f) } });
      show(`Tests loaded: ${r.loaded}`);
      await boot();
    } catch (err) { show(err.message); }
  };
  if ($("#seeddocs")) $("#seeddocs").onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const r = await api("/api/seed/doctors-csv", { method: "POST", body: { csv: await readText(f) } });
      show(`Doctors loaded: ${r.loaded}`);
      await boot();
    } catch (err) { show(err.message); }
  };
}

function billForm() {
  return `
    <div class="card">
      <h2>New emergency bill</h2>
      <div class="grid">
        <div>
          <label>Search patient (name / UHID / mobile)</label>
          <input id="pq" placeholder="Type at least 2 characters" />
          <div id="psug" class="suggest hidden"></div>
          <div class="grid" style="margin-top:8px">
            <div><label>First name</label><input id="fn" /></div>
            <div><label>Last name</label><input id="ln" /></div>
            <div><label>Mobile</label><input id="mob" /></div>
            <div><label>Sex</label><select id="sex"><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></div>
            <div><label>Age</label><input id="age" type="number" min="0" /></div>
            <div><label>UHID</label><input id="uhid" readonly /></div>
          </div>
        </div>
        <div>
          <label>Referring doctor</label>
          <input id="dq" placeholder="Search name / specialization — blank = walk-in" autocomplete="off" value="${state.referringDoctor ? escapeHtml(state.referringDoctor.name) : ""}" />
          <div id="dsug" class="suggest hidden"></div>
          <div id="docpicked" class="muted">${state.referringDoctor ? escapeHtml(state.referringDoctor.name) + (state.referringDoctor.specialization ? " · " + escapeHtml(state.referringDoctor.specialization) : "") : "Walk-in / none"}</div>
          <label>Search service</label>
          <input id="sq" placeholder="MRI, CBC…" />
          <div id="ssug" class="suggest hidden"></div>
          <div id="lines"></div>
        </div>
      </div>
      <div class="tot" style="margin:12px 0">
        <div>Gross <b id="gross">₹0</b></div>
        <div>Discount <input id="disc" type="number" min="0" value="0" /></div>
        <div>Net <b id="net">₹0</b></div>
        <div>Due <b id="due">₹0</b></div>
      </div>
      <div class="grid">
        <div><label>Discount reason</label><select id="dreason"><option value="">—</option>${state.reasons.map(r => `<option>${escapeHtml(r)}</option>`).join("")}</select></div>
        <div><label>Notes</label><input id="notes" /></div>
        <div><label>Cash</label><input id="cash" type="number" min="0" value="0" /></div>
        <div><label>UPI</label><input id="upi" type="number" min="0" value="0" /></div>
        <div><label>Card</label><input id="card" type="number" min="0" value="0" /></div>
      </div>
      <div class="row" style="margin-top:12px">
        <button id="save">Save & print receipt</button>
        <span id="berr" class="muted"></span>
      </div>
    </div>`;
}

function bindBillForm() {
  $("#pq").oninput = debounce(async (e) => {
    const q = e.target.value.trim();
    if (q.length < 2) { $("#psug").classList.add("hidden"); return; }
    const rows = await api("/api/patients?q=" + encodeURIComponent(q));
    const box = $("#psug");
    box.classList.remove("hidden");
    box.innerHTML = rows.map((p) => `<div data-id="${p.id}">${escapeHtml(p.patient_id)} — ${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)} · ${escapeHtml(p.phone)}</div>`).join("") || "<div>No local match — register below</div>";
    box.querySelectorAll("div[data-id]").forEach((el) => {
      el.onclick = () => {
        const p = rows.find((x) => String(x.id) === el.dataset.id);
        state.patient = p;
        $("#fn").value = p.first_name;
        $("#ln").value = p.last_name;
        $("#mob").value = p.phone;
        $("#uhid").value = p.patient_id;
        $("#age").value = p.age_value || "";
        $("#sex").value = String(p.gender || "").toLowerCase().startsWith("f") ? "F" : String(p.gender || "").toLowerCase().startsWith("m") ? "M" : "O";
        box.classList.add("hidden");
      };
    });
  });
  if ($("#dq")) {
    const loadDocs = async (q) => {
      const box = $("#dsug");
      const picked = $("#docpicked");
      if (!box) return;
      if (state.referringDoctor && q && q !== state.referringDoctor.name) state.referringDoctor = null;
      const rows = await api("/api/doctors?q=" + encodeURIComponent(q || ""));
      box.classList.remove("hidden");
      box.innerHTML = `<div data-id="">Walk-in / none</div>` + rows.map((d) =>
        `<div data-id="${d.id}">${escapeHtml(d.name)}${d.specialization ? " · " + escapeHtml(d.specialization) : ""}</div>`
      ).join("") || `<div class="muted">No doctors in cache — upload doctors.csv or USB seed</div>`;
      box.querySelectorAll("div[data-id]").forEach((el) => {
        el.onclick = () => {
          if (!el.dataset.id) {
            state.referringDoctor = null;
            $("#dq").value = "";
            if (picked) picked.textContent = "Walk-in / none";
          } else {
            const d = rows.find((x) => String(x.id) === el.dataset.id);
            state.referringDoctor = d ? { id: d.id, name: d.name, specialization: d.specialization || "" } : null;
            $("#dq").value = d?.name || "";
            if (picked) picked.textContent = d ? (d.name + (d.specialization ? " · " + d.specialization : "")) : "Walk-in / none";
          }
          box.classList.add("hidden");
        };
      });
    };
    $("#dq").oninput = debounce(async (e) => { await loadDocs(e.target.value.trim()); }, 150);
    $("#dq").onfocus = async (e) => { await loadDocs(e.target.value.trim()); };
  }
  $("#sq").oninput = debounce(async (e) => {
    const q = e.target.value.trim();
    if (q.length < 1) { $("#ssug").classList.add("hidden"); return; }
    const rows = await api("/api/services?q=" + encodeURIComponent(q));
    const box = $("#ssug");
    box.classList.remove("hidden");
    box.innerHTML = rows.map((s) => `<div data-id="${s.id}">${escapeHtml(s.category)} · ${escapeHtml(s.name)} — ${fmt(s.price)}</div>`).join("");
    box.querySelectorAll("div[data-id]").forEach((el) => {
      el.onclick = () => {
        const s = rows.find((x) => String(x.id) === el.dataset.id);
        state.lines.push({ careServiceId: s.id, serviceName: s.name, category: s.category, quantity: 1, unitPrice: Number(s.price) });
        $("#sq").value = "";
        box.classList.add("hidden");
        renderLines();
      };
    });
  });
  $("#disc").oninput = $("#cash").oninput = $("#upi").oninput = $("#card").oninput = updateTotals;
  $("#save").onclick = saveBill;
  renderLines();
}

function renderLines() {
  const el = $("#lines");
  if (!el) return;
  el.innerHTML = state.lines.map((l, i) => `<div class="row">${escapeHtml(l.serviceName)} × <input data-i="${i}" class="qty" type="number" min="1" value="${l.quantity}" style="width:70px"> ${fmt(l.unitPrice * l.quantity)} <button class="danger rm" data-i="${i}">×</button></div>`).join("");
  el.querySelectorAll(".qty").forEach((inp) => inp.oninput = () => { state.lines[Number(inp.dataset.i)].quantity = Number(inp.value || 1); renderLines(); });
  el.querySelectorAll(".rm").forEach((b) => b.onclick = () => { state.lines.splice(Number(b.dataset.i), 1); renderLines(); });
  updateTotals();
}

function updateTotals() {
  const gross = state.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const disc = Number($("#disc")?.value || 0);
  const net = Math.max(0, gross - disc);
  const rec = Number($("#cash")?.value || 0) + Number($("#upi")?.value || 0) + Number($("#card")?.value || 0);
  if ($("#gross")) $("#gross").textContent = fmt(gross);
  if ($("#net")) $("#net").textContent = fmt(net);
  if ($("#due")) $("#due").textContent = fmt(Math.max(0, net - rec));
}

async function saveBill() {
  $("#berr").textContent = "";
  try {
    const doc = state.referringDoctor;
    const typedDocName = ($("#dq")?.value || "").trim();
    const txn = await api("/api/bills", {
      method: "POST",
      body: {
        patient: {
          carePatientId: state.patient?.id || null,
          uhid: $("#uhid").value || null,
          firstName: $("#fn").value,
          lastName: $("#ln").value,
          mobile: $("#mob").value,
          sex: $("#sex").value,
          ageValue: $("#age").value ? Number($("#age").value) : null,
          ageUnit: "years",
        },
        referringDoctorId: doc?.id ?? null,
        referringDoctorName: doc?.name || typedDocName || null,
        lines: state.lines.map((l) => ({ careServiceId: l.careServiceId, quantity: l.quantity })),
        discountAmount: Number($("#disc").value || 0),
        discountReason: $("#dreason").value || null,
        notes: $("#notes").value || null,
        payments: [
          { method: "cash", amount: Number($("#cash").value || 0) },
          { method: "upi", amount: Number($("#upi").value || 0) },
          { method: "card", amount: Number($("#card").value || 0) },
        ],
      },
    });
    state.lines = [];
    state.patient = null;
    state.referringDoctor = null;
    printReceipt(txn);
    await refreshBills();
    render();
  } catch (err) { $("#berr").textContent = err.message; }
}

function printReceipt(t) {
  const el = $("#receipt");
  const refDoctor = String(t.referringDoctorName || "").trim() || "Walk-in";
  el.classList.remove("hidden");
  el.innerHTML = `
    <h2>CARE Ultra-Emergency Receipt</h2>
    <div><b>${t.emergencyBillNumber}</b></div>
    <div>${t.patient.firstName} ${t.patient.lastName} ${t.patient.uhid || ""}</div>
    <div>${t.patient.mobile}</div>
    <div><b>Ref. Doctor</b> ${escapeHtml(refDoctor)}</div>
    <table>${t.lines.map((l) => `<tr><td>${l.serviceName}</td><td>${l.quantity}</td><td>${fmt(l.lineGross)}</td></tr>`).join("")}</table>
    <p>Gross ${fmt(t.grossAmount)} · Discount ${fmt(t.discountAmount)} · Net ${fmt(t.netAmount)}</p>
    <p>Received ${fmt(t.amountReceived)} · Due ${fmt(t.dueAmount)}</p>
    <p>${t.payments.map((p) => p.method + " " + fmt(p.amount)).join(" · ")}</p>
    <p>Staff: ${t.createdByStaffName}</p>
    <p>This is an emergency receipt. Final CARE bill is issued after reconciliation.</p>`;
  window.print();
  api("/api/bills/" + t.emergencyTransactionUuid + "/reprint", { method: "POST" }).catch(() => {});
}

function renderBills() {
  const el = $("#bills");
  if (!el) return;
  el.innerHTML = `<table><thead><tr><th>No</th><th>Patient</th><th>Ref. Doctor</th><th>Net</th><th>Paid</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
    ${state.bills.map((b) => `<tr>
      <td>${escapeHtml(b.emergencyBillNumber)}</td>
      <td>${escapeHtml(b.patient.firstName + " " + b.patient.lastName)}</td>
      <td>${escapeHtml(b.referringDoctorName || "Walk-in")}</td>
      <td>${fmt(b.netAmount)}</td>
      <td>${fmt(b.amountReceived)}</td>
      <td>${fmt(b.dueAmount)}</td>
      <td>${b.status}</td>
      <td>${b.status === "PENDING" ? `<button class="danger void" data-u="${b.emergencyTransactionUuid}">Void</button>` : ""}
          <button class="secondary pr" data-u="${b.emergencyTransactionUuid}">Print</button></td>
    </tr>`).join("")}
  </tbody></table>`;
  el.querySelectorAll(".void").forEach((b) => b.onclick = async () => {
    const reason = prompt("Void reason?");
    if (!reason) return;
    await api("/api/bills/" + b.dataset.u + "/void", { method: "POST", body: { reason } });
    await refreshBills();
    render();
  });
  el.querySelectorAll(".pr").forEach((b) => b.onclick = () => {
    const t = state.bills.find((x) => x.emergencyTransactionUuid === b.dataset.u);
    if (t) printReceipt(t);
  });
}

async function startSession() {
  const reason = prompt("Reason for emergency billing?");
  if (!reason) return;
  await api("/api/session/start", { method: "POST", body: { reason, workstation: navigator.userAgent } });
  await boot();
}
async function endSession() {
  if (!confirm("End emergency session? Reception will be locked.")) return;
  await api("/api/session/end", { method: "POST", body: {} });
  await boot();
}
async function download(url, name) {
  const res = await fetch(url, { credentials: "include" });
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
async function refreshBills() {
  try { state.bills = await api("/api/bills"); } catch { state.bills = []; }
}
async function boot() {
  try {
    const me = await api("/api/me");
    state.me = me.staff;
    state.locked = me.locked;
    state.session = me.session;
    state.syncedAt = me.masterDataLastSyncedAt;
    state.ageBand = me.ageBand || "never";
    state.neverSynced = !!me.neverSynced;
    state.counts = me.counts || state.counts;
    state.reasons = await api("/api/discount-reasons");
    await refreshBills();
  } catch {
    const st = await api("/api/status");
    state.me = null;
    state.locked = st.locked;
    state.syncedAt = st.masterDataLastSyncedAt;
    state.ageBand = st.ageBand || "never";
    state.neverSynced = !!st.neverSynced;
    state.counts = st.counts || state.counts;
  }
  render();
}
function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
boot();
