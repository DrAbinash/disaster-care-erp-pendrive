import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EmergencySessionRecord, EmergencyTransaction, MasterDataSnapshot } from "@workspace/emergency-billing";

export type CachedService = MasterDataSnapshot["services"][number];
export type CachedDoctor = MasterDataSnapshot["doctors"][number];
export type CachedPatient = MasterDataSnapshot["patients"][number];
export type CachedStaff = MasterDataSnapshot["staff"][number];

export interface StaffSessionRow {
  token: string;
  staffId: number;
  staffName: string;
  role: string;
  maxDiscount: number;
  expiresAt: string;
}

export interface AuditRow {
  id: number;
  at: string;
  staffId: number | null;
  staffName: string;
  action: string;
  entityUuid: string | null;
  detail: string;
  ip: string | null;
}

export interface PendriveStoreData {
  meta: Record<string, string>;
  services: CachedService[];
  doctors: CachedDoctor[];
  patients: CachedPatient[];
  staff: CachedStaff[];
  discountReasons: string[];
  sessions: EmergencySessionRecord[];
  transactions: EmergencyTransaction[];
  audit: AuditRow[];
  staffSessions: StaffSessionRow[];
  nextAuditId: number;
}

const empty = (): PendriveStoreData => ({
  meta: {},
  services: [],
  doctors: [],
  patients: [],
  staff: [],
  discountReasons: [],
  sessions: [],
  transactions: [],
  audit: [],
  staffSessions: [],
  nextAuditId: 1,
});

export class PendriveStore {
  data: PendriveStoreData;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {
    this.data = empty();
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<PendriveStoreData>;
      this.data = { ...empty(), ...parsed, meta: parsed.meta ?? {} };
    } catch {
      this.data = empty();
      await this.save();
    }
  }

  save(): Promise<void> {
    this.chain = this.chain.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
      await rename(tmp, this.file);
    });
    return this.chain;
  }

  getMeta(key: string): string {
    return this.data.meta[key] ?? "";
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.data.meta[key] = value;
    await this.save();
  }

  applyMasterSnapshot(snap: MasterDataSnapshot): void {
    this.data.services = snap.services.filter((s) => s.isActive !== false);
    this.data.doctors = snap.doctors;
    this.data.patients = snap.patients;
    this.data.staff = snap.staff;
    this.data.discountReasons = snap.discountReasons;
    this.data.meta.master_data_last_synced_at = snap.syncedAt;
  }

  applyTests(tests: CachedService[]): void {
    this.data.services = tests.filter((s) => s.isActive !== false);
    if (!this.data.meta.master_data_last_synced_at) {
      this.data.meta.master_data_last_synced_at = new Date().toISOString();
    }
    this.data.meta.tests_seeded_at = new Date().toISOString();
  }

  applyDoctors(doctors: CachedDoctor[]): void {
    this.data.doctors = doctors;
    if (!this.data.meta.master_data_last_synced_at) {
      this.data.meta.master_data_last_synced_at = new Date().toISOString();
    }
    this.data.meta.doctors_seeded_at = new Date().toISOString();
  }

  activeSession(): EmergencySessionRecord | null {
    return this.data.sessions.find((s) => !s.endedAt) ?? null;
  }

  nextBillNumber(ymd: string, format: (ymd: string, seq: number) => string): string {
    const prefix = `EMG-${ymd}-`;
    let max = 0;
    for (const t of this.data.transactions) {
      if (!t.emergencyBillNumber.startsWith(prefix)) continue;
      const seq = Number(t.emergencyBillNumber.slice(prefix.length));
      if (seq > max) max = seq;
    }
    return format(ymd, max + 1);
  }
}
