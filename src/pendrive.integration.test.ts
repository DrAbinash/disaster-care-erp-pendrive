import { createServer } from "node:http";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseEmergencyCsv, serializeTestsSeedCsv, serializeDoctorsSeedCsv } from "@workspace/emergency-billing";

const pin = "1234";

describe("pendrive ultra-emergency app", () => {
  let base = "";
  let jar = "";
  let tmp = "";
  let close: () => Promise<void>;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "pendrive-"));
    process.env.PENDRIVE_ROOT = tmp;
    process.env.PENDRIVE_BOOTSTRAP_PIN = pin;
    await mkdir(path.join(tmp, "data", "seed"), { recursive: true });
    await mkdir(path.join(tmp, "export"), { recursive: true });
    await mkdir(path.join(tmp, "public"), { recursive: true });
    await writeFile(path.join(tmp, "public", "index.html"), "<div id='app'></div>");
    const { createApp } = await import("./server");
    const app = await createApp();
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
    close = () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }, 20_000);

  afterAll(async () => {
    await close?.();
    await rm(tmp, { recursive: true, force: true });
  });

  it("logs in with bootstrap owner, seeds tests/doctors, bills, exports CARE CSV", async () => {
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "owner", pin }),
    });
    expect(login.status).toBe(200);
    jar = login.headers.get("set-cookie") || "";
    const h = { "Content-Type": "application/json", cookie: jar };

    const testsCsv = serializeTestsSeedCsv([
      { id: 1, code: "MRI-BR", name: "MRI Brain", category: "MRI", price: 4000, isActive: true },
    ]);
    const tRes = await fetch(base + "/api/seed/tests-csv", { method: "POST", headers: h, body: JSON.stringify({ csv: testsCsv }) });
    expect(tRes.status).toBe(200);

    const dCsv = serializeDoctorsSeedCsv([{ id: 2, name: "Dr Test", specialization: "Radiology" }]);
    const dRes = await fetch(base + "/api/seed/doctors-csv", { method: "POST", headers: h, body: JSON.stringify({ csv: dCsv }) });
    expect(dRes.status).toBe(200);

    const start = await fetch(base + "/api/session/start", {
      method: "POST", headers: h, body: JSON.stringify({ reason: "ultra emergency drill" }),
    });
    expect(start.status).toBe(200);

    const bill = await fetch(base + "/api/bills", {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        patient: { firstName: "Ravi", lastName: "Kumar", mobile: "9876543210", sex: "M", ageValue: 42 },
        referringDoctorId: 2,
        referringDoctorName: "Dr Test",
        lines: [{ careServiceId: 1, quantity: 1 }],
        payments: [{ method: "cash", amount: 3000 }],
      }),
    });
    expect(bill.status).toBe(201);
    const txn = await bill.json();
    expect(txn.emergencyBillNumber).toMatch(/^EMG-\d{8}-\d{5}$/);
    expect(txn.dueAmount).toBe(1000);

    const csvRes = await fetch(base + "/api/export/csv", { headers: { cookie: jar } });
    expect(csvRes.status).toBe(200);
    const csv = await csvRes.text();
    const parsed = parseEmergencyCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0]!.dueAmount).toBe(1000);
    expect(parsed.transactions[0]!.referringDoctorName).toBe("Dr Test");
    expect(csv).toContain("CARE_EMERGENCY_BILLING_V1");
    expect(csv).toContain("Dr Test");
  });

  it("rejects a billing CSV as tests seed", async () => {
    const h = { "Content-Type": "application/json", cookie: jar };
    const bad = await fetch(base + "/api/seed/tests-csv", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ csv: "format,emergency_transaction_uuid\nCARE_EMERGENCY_BILLING_V1,x\n" }),
    });
    expect(bad.status).toBe(400);
  });
});

describe("pendrive seed merge on boot", () => {
  let base = "";
  let tmp = "";
  let close: () => Promise<void>;

  beforeAll(async () => {
    vi.resetModules();
    tmp = await mkdtemp(path.join(os.tmpdir(), "pendrive-seed-"));
    process.env.PENDRIVE_ROOT = tmp;
    process.env.PENDRIVE_BOOTSTRAP_PIN = pin;
    await mkdir(path.join(tmp, "data", "seed"), { recursive: true });
    await mkdir(path.join(tmp, "export"), { recursive: true });
    await mkdir(path.join(tmp, "public"), { recursive: true });
    await writeFile(path.join(tmp, "public", "index.html"), "<div id='app'></div>");

    const master = {
      format: "CARE_EMERGENCY_MASTER_V1",
      version: 1,
      syncedAt: "2026-08-14T11:35:00.000Z",
      services: [{ id: 1, code: "MRI-BR", name: "MRI Brain", category: "MRI", price: 4000, isActive: true }],
      doctors: [],
      patients: [],
      staff: [],
      discountReasons: [],
    };
    await writeFile(path.join(tmp, "data", "seed", "CARE_EMERGENCY_MASTER_V1.json"), JSON.stringify(master));
    const dCsv = serializeDoctorsSeedCsv([{ id: 5, name: "Dr Seed Merge", specialization: "Radiology" }]);
    await writeFile(path.join(tmp, "data", "seed", "doctors.csv"), dCsv);

    const { createApp } = await import("./server");
    const app = await createApp();
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
    close = () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }, 20_000);

  afterAll(async () => {
    await close?.();
    await rm(tmp, { recursive: true, force: true });
  });

  it("loads doctors.csv when master JSON has empty doctors[]", async () => {
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "owner", pin }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") || "";
    const me = await fetch(base + "/api/me", { headers: { cookie } });
    const body = await me.json();
    expect(body.counts.serviceCount).toBe(1);
    expect(body.counts.doctorCount).toBe(1);

    const docs = await fetch(base + "/api/doctors?q=merge", { headers: { cookie } });
    const rows = await docs.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Dr Seed Merge");
  });
});

describe("pendrive login after CARE master seed", () => {
  let base = "";
  let tmp = "";
  let close: () => Promise<void>;

  beforeAll(async () => {
    vi.resetModules();
    tmp = await mkdtemp(path.join(os.tmpdir(), "pendrive-login-"));
    process.env.PENDRIVE_ROOT = tmp;
    process.env.PENDRIVE_BOOTSTRAP_PIN = pin;
    await mkdir(path.join(tmp, "data", "seed"), { recursive: true });
    await mkdir(path.join(tmp, "export"), { recursive: true });
    await mkdir(path.join(tmp, "public"), { recursive: true });
    await writeFile(path.join(tmp, "public", "index.html"), "<div id='app'></div>");

    const pinHash = await (await import("bcryptjs")).default.hash(pin, 4);
    const master = {
      format: "CARE_EMERGENCY_MASTER_V1",
      version: 1,
      syncedAt: "2026-08-14T11:35:00.000Z",
      services: [{ id: 1, code: "MRI-BR", name: "MRI Brain", category: "MRI", price: 4000, isActive: true }],
      doctors: [{ id: 2, name: "Dr Test", specialization: "Radiology" }],
      patients: [],
      staff: [{
        id: 1, name: "Dr Abinash Kumar", username: "abinash", role: "super_admin",
        pinHash, maxDiscount: 100, permissions: null,
      }],
      discountReasons: [],
    };
    await writeFile(path.join(tmp, "data", "seed", "CARE_EMERGENCY_MASTER_V1.json"), JSON.stringify(master));

    const { createApp } = await import("./server");
    const app = await createApp();
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
    close = () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }, 20_000);

  afterAll(async () => {
    await close?.();
    await rm(tmp, { recursive: true, force: true });
  });

  it("accepts CARE username abinash and keeps owner fallback after seed", async () => {
    const care = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "abinash", pin }),
    });
    expect(care.status).toBe(200);
    expect((await care.json()).name).toBe("Dr Abinash Kumar");

    const owner = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "owner", pin }),
    });
    expect(owner.status).toBe(200);

    const email = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "abinashsingh@gmail.com", pin }),
    });
    expect(email.status).toBe(401);
    const err = await email.json();
    expect(err.error).toMatch(/CARE username/i);
  });
});
