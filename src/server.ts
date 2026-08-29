import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import {
  buildEmergencyJsonPackage,
  countsFromSnapshot,
  formatEmgBillNumber,
  istYyyymmdd,
  parseDoctorsSeedCsv,
  parseMasterSnapshot,
  parseTestsSeedCsv,
  searchCachedDoctors,
  serializeEmergencyCsv,
  snapshotAgeBand,
  snapshotAgeHours,
  UnsupportedContractError,
  type EmergencyTransaction,
  type MasterDataSnapshot,
} from "@workspace/emergency-billing";
import { PendriveStore } from "./store.ts";

// Avoid naming this `__dirname` — esbuild's ESM CJS shim already declares that
// name in the bundled server.mjs and a second declaration crashes Node on boot.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.PENDRIVE_ROOT || path.resolve(moduleDir, "..");
const COOKIE = "emg_usb_session";
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 8);
const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const PORT = Number(process.env.PORT || 8898);
const HOST = process.env.HOST || "127.0.0.1";

type Staff = { id: number; name: string; username: string; role: string; maxDiscount: number };
interface AuthedRequest extends Request {
  staff?: Staff;
}

const store = new PendriveStore(path.join(ROOT, "data", "emergency-store.json"));

async function audit(staff: Staff | null, action: string, entityUuid: string | null, detail: string, ip?: string) {
  store.data.audit.push({
    id: store.data.nextAuditId++,
    at: new Date().toISOString(),
    staffId: staff?.id ?? null,
    staffName: staff?.name ?? "system",
    action,
    entityUuid,
    detail,
    ip: ip ?? null,
  });
  await store.save();
}

function masterSyncStatus() {
  const syncedAt = store.getMeta("master_data_last_synced_at") || null;
  return {
    masterDataLastSyncedAt: syncedAt,
    neverSynced: !syncedAt,
    ageBand: snapshotAgeBand(syncedAt),
    snapshotAgeHours: snapshotAgeHours(syncedAt),
    counts: {
      serviceCount: store.data.services.length,
      doctorCount: store.data.doctors.length,
      patientCount: store.data.patients.length,
      staffCount: store.data.staff.length,
    },
    source: "USB_PENDRIVE",
  };
}

async function ensureBootstrapOwner() {
  const pin = process.env.PENDRIVE_BOOTSTRAP_PIN || "1234";
  const existing = store.data.staff.find((s) => s.username.toLowerCase() === "owner");
  if (existing) return;
  // Keep a local unlock account even after CARE USB seed is applied, so
  // reception can still open the stick if they forget the CARE username.
  const pinHash = await bcrypt.hash(pin, 10);
  const maxId = store.data.staff.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0);
  store.data.staff.push({
    id: maxId + 1 || 1,
    name: "Pendrive owner",
    username: "owner",
    role: "super_admin",
    pinHash,
    maxDiscount: 100,
    permissions: null,
  });
  await store.save();
}

async function loadSeedFromDisk() {
  const seedDir = path.join(ROOT, "data", "seed");
  const tryRead = async (name: string) => {
    try {
      return await readFile(path.join(seedDir, name), "utf8");
    } catch {
      return null;
    }
  };
  const masterRaw = (await tryRead("CARE_EMERGENCY_MASTER_V1.json")) || (await tryRead("master.json"));
  if (masterRaw) {
    store.applyMasterSnapshot(parseMasterSnapshot(JSON.parse(masterRaw)));
  }
  const testsRaw = await tryRead("tests.csv");
  if (testsRaw) {
    const parsed = parseTestsSeedCsv(testsRaw);
    if (parsed.tests.length && (!masterRaw || store.data.services.length === 0)) {
      store.applyTests(parsed.tests);
    }
  }
  const doctorsRaw = await tryRead("doctors.csv");
  if (doctorsRaw) {
    const parsed = parseDoctorsSeedCsv(doctorsRaw);
    if (parsed.doctors.length && (!masterRaw || store.data.doctors.length === 0)) {
      store.applyDoctors(parsed.doctors);
    }
  }
  await store.save();
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE] || (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : "");
  if (!token) {
    res.status(401).json({ error: "Please log in" });
    return;
  }
  const s = store.data.staffSessions.find((x) => x.token === token);
  if (!s || new Date(s.expiresAt) < new Date()) {
    res.status(401).json({ error: "Session expired" });
    return;
  }
  req.staff = { id: s.staffId, name: s.staffName, username: "", role: s.role, maxDiscount: s.maxDiscount };
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.staff || !ADMIN_ROLES.has(req.staff.role)) {
    res.status(403).json({ error: "Owner / admin only" });
    return;
  }
  next();
}

async function writeExportFiles(csv: string, jsonObj: unknown) {
  const dir = path.join(ROOT, "export");
  await mkdir(dir, { recursive: true });
  const day = istYyyymmdd();
  const csvPath = path.join(dir, `CARE_EMERGENCY_BILLING_V1_${day}.csv`);
  const jsonPath = path.join(dir, `CARE_EMERGENCY_BILLING_JSON_V1_${day}.json`);
  await writeFile(csvPath, csv, "utf8");
  await writeFile(jsonPath, JSON.stringify(jsonObj, null, 2), "utf8");
  return { csvPath, jsonPath };
}

export async function createApp() {
  await store.load();
  await loadSeedFromDisk();
  await ensureBootstrapOwner();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16mb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "care-ultra-emergency-pendrive" });
  });

  app.get("/api/status", (_req, res) => {
    const session = store.activeSession();
    res.json({ locked: !session, session, ...masterSyncStatus(), loggedIn: false });
  });

  app.post("/api/login", async (req, res) => {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const pin = String(req.body?.pin || "");
    if (!username || !pin) {
      res.status(400).json({ error: "Username and PIN required" });
      return;
    }
    // Match CARE username (e.g. abinash). Also accept email local-part
    // (abinashsingh@gmail.com → try abinashsingh) as a convenience.
    const localPart = username.includes("@") ? username.split("@")[0]! : username;
    const u = store.data.staff.find((s) => {
      const uname = s.username.toLowerCase();
      return uname === username || uname === localPart;
    });
    if (!u || !u.pinHash || !(await bcrypt.compare(pin, u.pinHash))) {
      await audit(null, "login_failed", null, username, req.ip);
      res.status(401).json({
        error: "Invalid username or PIN. Use your CARE username (not full email), e.g. abinash — or owner / 1234.",
      });
      return;
    }
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
    store.data.staffSessions.push({
      token,
      staffId: u.id,
      staffName: u.name,
      role: u.role,
      maxDiscount: u.maxDiscount,
      expiresAt,
    });
    const staff: Staff = { id: u.id, name: u.name, username: u.username, role: u.role, maxDiscount: u.maxDiscount };
    await audit(staff, "login", null, "ok", req.ip);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_HOURS * 3600_000 });
    res.json({ name: staff.name, role: staff.role, maxDiscount: staff.maxDiscount });
  });

  app.post("/api/logout", requireAuth, async (req: AuthedRequest, res) => {
    const token = req.cookies?.[COOKIE];
    if (token) store.data.staffSessions = store.data.staffSessions.filter((s) => s.token !== token);
    await audit(req.staff!, "logout", null, "ok", req.ip);
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  app.get("/api/me", requireAuth, async (req: AuthedRequest, res) => {
    const session = store.activeSession();
    res.json({ staff: req.staff, locked: !session, session, ...masterSyncStatus() });
  });

  app.post("/api/seed/master", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    let snap: MasterDataSnapshot;
    try {
      snap = parseMasterSnapshot(req.body?.snapshot ?? req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(err instanceof UnsupportedContractError ? 409 : 400).json({ error: message });
      return;
    }
    store.applyMasterSnapshot(snap);
    await store.save();
    const counts = countsFromSnapshot(snap);
    await audit(req.staff!, "seed_master", null, `${counts.serviceCount} tests / ${counts.doctorCount} doctors`);
    res.json({ ok: true, syncedAt: snap.syncedAt, ...counts });
  });

  app.post("/api/seed/tests-csv", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const raw = typeof req.body?.csv === "string" ? req.body.csv : "";
    const parsed = parseTestsSeedCsv(raw);
    if (!parsed.tests.length) {
      res.status(400).json({ error: parsed.errors[0] || "No tests in CSV", errors: parsed.errors });
      return;
    }
    store.applyTests(parsed.tests);
    await store.save();
    await audit(req.staff!, "seed_tests", null, `${parsed.tests.length} tests`);
    res.json({ ok: true, loaded: parsed.tests.length, errors: parsed.errors, ...masterSyncStatus() });
  });

  app.post("/api/seed/doctors-csv", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const raw = typeof req.body?.csv === "string" ? req.body.csv : "";
    const parsed = parseDoctorsSeedCsv(raw);
    if (!parsed.doctors.length) {
      res.status(400).json({ error: parsed.errors[0] || "No doctors in CSV", errors: parsed.errors });
      return;
    }
    store.applyDoctors(parsed.doctors);
    await store.save();
    await audit(req.staff!, "seed_doctors", null, `${parsed.doctors.length} doctors`);
    res.json({ ok: true, loaded: parsed.doctors.length, errors: parsed.errors, ...masterSyncStatus() });
  });

  app.post("/api/session/start", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 3) {
      res.status(400).json({ error: "Reason is required" });
      return;
    }
    if (store.activeSession()) {
      res.status(409).json({ error: "An emergency session is already active", session: store.activeSession() });
      return;
    }
    if (store.data.services.length < 1) {
      res.status(409).json({ error: "Upload tests first (USB seed zip from CARE super admin, or tests.csv)" });
      return;
    }
    const rec = {
      emergencySessionUuid: randomUUID(),
      startedAt: new Date().toISOString(),
      startedByStaffId: req.staff!.id,
      startedByStaffName: req.staff!.name,
      reason,
      workstation: String(req.body?.workstation || "pendrive"),
      endedAt: null,
      endedByStaffId: null,
      endedByStaffName: null,
    };
    store.data.sessions.push(rec);
    await audit(req.staff!, "session_start", rec.emergencySessionUuid, reason, req.ip);
    res.json(rec);
  });

  app.post("/api/session/end", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const current = store.activeSession();
    if (!current) {
      res.status(409).json({ error: "No active emergency session" });
      return;
    }
    current.endedAt = new Date().toISOString();
    current.endedByStaffId = req.staff!.id;
    current.endedByStaffName = req.staff!.name;
    await audit(req.staff!, "session_end", current.emergencySessionUuid, "closed", req.ip);
    res.json({ ok: true, sessionUuid: current.emergencySessionUuid });
  });

  app.get("/api/patients", requireAuth, (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const digits = q.replace(/\D/g, "");
    const rows = store.data.patients.filter((p) => {
      const name = `${p.firstName} ${p.lastName}`.toLowerCase();
      return (
        p.firstName.toLowerCase().includes(q) ||
        p.lastName.toLowerCase().includes(q) ||
        name.includes(q) ||
        p.patientId.toLowerCase().includes(q) ||
        (digits && p.phone.includes(digits))
      );
    }).slice(0, 25);
    res.json(rows.map((p) => ({
      id: p.id,
      patient_id: p.patientId,
      first_name: p.firstName,
      last_name: p.lastName,
      phone: p.phone,
      gender: p.gender,
      age_value: p.ageValue,
    })));
  });

  app.get("/api/services", requireAuth, (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    const rows = store.data.services.filter((s) => {
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || s.category.toLowerCase().includes(q);
    }).slice(0, 40);
    res.json(rows);
  });

  app.get("/api/doctors", requireAuth, (req, res) => {
    res.json(searchCachedDoctors(store.data.doctors, String(req.query.q || "")));
  });

  app.get("/api/discount-reasons", requireAuth, (_req, res) => {
    res.json(store.data.discountReasons);
  });

  app.get("/api/bills", requireAuth, (_req, res) => {
    res.json([...store.data.transactions].reverse().slice(0, 200));
  });

  app.post("/api/bills", requireAuth, async (req: AuthedRequest, res) => {
    const session = store.activeSession();
    if (!session) {
      res.status(423).json({ error: "EMERGENCY BILLING LOCKED. Ask the owner to start an emergency session." });
      return;
    }
    const body = req.body ?? {};
    const patient = body.patient ?? {};
    const firstName = String(patient.firstName || "").trim();
    const lastName = String(patient.lastName || "").trim() || "-";
    const mobile = String(patient.mobile || "").trim();
    if (!firstName || !mobile) {
      res.status(400).json({ error: "Patient name and mobile are required" });
      return;
    }
    const linesIn = Array.isArray(body.lines) ? body.lines : [];
    if (!linesIn.length) {
      res.status(400).json({ error: "Add at least one service" });
      return;
    }
    const lines = [];
    let gross = 0;
    for (const raw of linesIn) {
      const svc = store.data.services.find((s) => s.id === Number(raw.careServiceId) && s.isActive !== false);
      if (!svc) {
        res.status(400).json({ error: `Unknown or inactive service ${raw.careServiceId}` });
        return;
      }
      const qty = Math.max(1, Number(raw.quantity || 1));
      const unit = Number(svc.price);
      const lineGross = Math.round(qty * unit * 100) / 100;
      gross += lineGross;
      lines.push({
        careServiceId: svc.id,
        serviceCode: svc.code,
        serviceName: svc.name,
        category: svc.category,
        quantity: qty,
        unitPrice: unit,
        lineGross,
      });
    }
    gross = Math.round(gross * 100) / 100;
    const discount = Math.max(0, Number(body.discountAmount || 0));
    if (discount > gross) {
      res.status(400).json({ error: "Discount cannot exceed gross" });
      return;
    }
    if (discount > 0 && !String(body.discountReason || "").trim()) {
      res.status(400).json({ error: "Discount reason is required" });
      return;
    }
    if (!ADMIN_ROLES.has(req.staff!.role) && discount > 0) {
      const maxAllowed = Math.round((gross * (req.staff!.maxDiscount || 0) / 100) * 100) / 100;
      if (discount > maxAllowed + 0.01) {
        res.status(403).json({ error: `Your maximum discount is ${req.staff!.maxDiscount}%` });
        return;
      }
    }
    const net = Math.round((gross - discount) * 100) / 100;
    const payments = (Array.isArray(body.payments) ? body.payments : [])
      .map((p: { method?: string; amount?: number }) => ({
        method: (p.method === "upi" || p.method === "card" ? p.method : "cash") as "cash" | "upi" | "card",
        amount: Number(p.amount || 0),
      }))
      .filter((p: { amount: number }) => p.amount > 0);
    const received = Math.round(payments.reduce((s: number, p: { amount: number }) => s + p.amount, 0) * 100) / 100;
    if (received > net + 0.01) {
      res.status(400).json({ error: "Amount received cannot exceed net" });
      return;
    }
    const due = Math.round((net - received) * 100) / 100;
    const uuid = randomUUID();
    const billNumber = store.nextBillNumber(istYyyymmdd(), formatEmgBillNumber);
    const txn: EmergencyTransaction = {
      emergencyTransactionUuid: uuid,
      emergencyBillNumber: billNumber,
      emergencySessionUuid: session.emergencySessionUuid,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      createdByStaffId: req.staff!.id,
      createdByStaffName: req.staff!.name,
      patient: {
        carePatientId: patient.carePatientId ? Number(patient.carePatientId) : null,
        uhid: patient.uhid || null,
        firstName,
        lastName,
        sex: patient.sex || "O",
        ageValue: patient.ageValue != null ? Number(patient.ageValue) : null,
        ageUnit: patient.ageUnit || "years",
        dateOfBirth: patient.dateOfBirth || null,
        mobile,
      },
      referringDoctorId: body.referringDoctorId ? Number(body.referringDoctorId) : null,
      referringDoctorName: body.referringDoctorName || null,
      lines,
      grossAmount: gross,
      discountAmount: discount,
      discountReason: body.discountReason || null,
      netAmount: net,
      amountReceived: received,
      dueAmount: due,
      payments,
      notes: body.notes || null,
      tariffSyncedAt: store.getMeta("master_data_last_synced_at") || null,
    };
    store.data.transactions.push(txn);
    await audit(req.staff!, discount > 0 ? "bill_create_discount" : "bill_create", uuid, billNumber, req.ip);
    res.status(201).json(txn);
  });

  app.post("/api/bills/:uuid/void", requireAuth, async (req: AuthedRequest, res) => {
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 3) {
      res.status(400).json({ error: "Void reason is required" });
      return;
    }
    const row = store.data.transactions.find((t) => t.emergencyTransactionUuid === String(req.params.uuid));
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (row.status === "VOID") {
      res.json(row);
      return;
    }
    if (row.status === "RECONCILED") {
      res.status(409).json({ error: "Already imported into CARE — void on CARE instead" });
      return;
    }
    row.status = "VOID";
    row.voidedAt = new Date().toISOString();
    row.voidedByStaffName = req.staff!.name;
    row.voidReason = reason;
    await audit(req.staff!, "void", row.emergencyTransactionUuid, reason, req.ip);
    res.json(row);
  });

  app.post("/api/bills/:uuid/reprint", requireAuth, async (req: AuthedRequest, res) => {
    await audit(req.staff!, "reprint", String(req.params.uuid), "print", req.ip);
    res.json({ ok: true });
  });

  app.get("/api/export/csv", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const pendingOnly = String(req.query.pending || "1") !== "0";
    const rows = store.data.transactions.filter((t) => (pendingOnly ? t.status !== "VOID" : true));
    const csv = serializeEmergencyCsv(rows);
    const json = buildEmergencyJsonPackage({
      sessions: store.data.sessions,
      transactions: store.data.transactions,
      masterDataLastSyncedAt: store.getMeta("master_data_last_synced_at") || null,
    });
    const paths = await writeExportFiles(csv, json);
    await audit(req.staff!, "export_csv", null, `${rows.length} rows → ${paths.csvPath}`, req.ip);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="CARE_EMERGENCY_BILLING_V1_${istYyyymmdd()}.csv"`);
    res.send(csv);
  });

  app.get("/api/export/json", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const pkg = buildEmergencyJsonPackage({
      sessions: store.data.sessions,
      transactions: store.data.transactions,
      masterDataLastSyncedAt: store.getMeta("master_data_last_synced_at") || null,
    });
    await writeExportFiles(serializeEmergencyCsv(store.data.transactions.filter((t) => t.status !== "VOID")), pkg);
    await audit(req.staff!, "export_json", null, `${store.data.transactions.length} rows`, req.ip);
    res.setHeader("Content-Disposition", `attachment; filename="CARE_EMERGENCY_BILLING_JSON_V1_${istYyyymmdd()}.json"`);
    res.json(pkg);
  });

  const publicDir = path.join(ROOT, "public");
  app.use(express.static(publicDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api") || req.path === "/health") return next();
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}

export { store };

async function main() {
  const app = await createApp();
  app.listen(PORT, HOST, () => {
    console.log(`CARE Ultra-Emergency (USB)  http://${HOST}:${PORT}`);
    console.log("Data folder:", path.join(ROOT, "data"));
    console.log("When CARE is back: Export CSV → CARE Settings → Emergency Billing → Upload CSV");
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
