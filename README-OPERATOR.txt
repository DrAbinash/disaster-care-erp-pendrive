CARE ULTRA-EMERGENCY (USB) — print this page

Use this stick ONLY when CARE (DS1522+) AND DS225+ Emergency Billing are both unusable.
If the NAS emergency page still opens, do not use this stick.

PREPARE (while CARE works) — super admin login only
1. CARE → Settings → Billing → Emergency Billing → Download USB seed.
2. Unzip. Copy seed/tests.csv, seed/doctors.csv, seed/CARE_EMERGENCY_MASTER_V1.json
   into this stick's data/seed/ folder.
3. Keep two sticks. Refresh after tariff or doctor changes.

DURING THE OUTAGE
1. Plug the stick into a reception PC. Double-click START-EMERGENCY.bat
   (browser opens http://127.0.0.1:8898).
2. Login: CARE username + PIN (from the seed). If never seeded: owner / 1234
   then upload tests.csv and doctors.csv in the USB seed panel.
3. Owner: START EMERGENCY SESSION. Reception bills and prints EMG-* receipts.
4. Never delete a bill. Void with a reason if needed.

WHEN CARE IS BACK
1. END session. Click Download CSV for CARE (also saved in export\ on this stick).
2. CARE → Settings → Emergency Billing → Upload CSV → Preview → Import safe.
3. Same file twice = 0 extra bills. Do not type the same visits into CARE by hand.
4. Do not also import a DS225+ export of the same visits.

This is not a second ERP. No accounts, commission, or PACS on the stick.
