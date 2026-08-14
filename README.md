# CARE Ultra-Emergency Billing (USB pendrive)

Standalone **capture-only** emergency billing that runs from a USB stick on a reception PC.

This is **not** the DS225+ Synology app (`225app`) and **not** CARE ERP (`care-on-synology1`).
CARE remains the only source of truth. Use this stick only when **CARE and DS225+ are both down**.

## Download

After each release: **Releases** → `CARE-ULTRA-EMERGENCY.zip`.

Unzip onto a USB drive. You should see `START-EMERGENCY.bat`.

## Prepare (super admin, while CARE is healthy)

1. Log into CARE ERP as **super admin**.
2. Settings → Billing → Emergency Billing → **Download USB seed**.
3. Copy `seed/tests.csv`, `seed/doctors.csv`, and `seed/CARE_EMERGENCY_MASTER_V1.json` into this stick’s `data/seed/` folder.

If the stick has no seed: start it, login `owner` / `1234`, and upload those files in the UI.

## Run (Windows)

1. Double-click `START-EMERGENCY.bat`.
2. Browser opens `http://127.0.0.1:8898` (localhost only).
3. Login with CARE username + PIN from the seed.
4. Owner starts an emergency session, reception bills, print `EMG-*` receipts.
5. When CARE is back: **Download CSV for CARE** and import it in CARE Settings → Emergency Billing (same `CARE_EMERGENCY_BILLING_V1` format as DS225+).

The CSV is also written to `export/` on the stick.

## Build this zip yourself

```sh
npm install
npm test
npm run pack    # writes pack-out/CARE-ULTRA-EMERGENCY.zip (includes Windows node.exe)
```

Linux/macOS for development: `npm run dev` then open http://127.0.0.1:8898

## What must not be on this stick

Accounting, commission, PACS, or a copy of CARE ERP.
