import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NODE_VERSION = process.env.PENDRIVE_NODE_VERSION || "22.18.0";
const outDir = path.join(root, "pack-out", "CARE-ULTRA-EMERGENCY");
const zipPath = path.join(root, "pack-out", "CARE-ULTRA-EMERGENCY.zip");

function run(cmd, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
  });
}

await rm(path.join(root, "pack-out"), { recursive: true, force: true });
await run(process.execPath, [path.join(root, "scripts/build.mjs")]);

await mkdir(path.join(outDir, "app"), { recursive: true });
await mkdir(path.join(outDir, "runtime"), { recursive: true });
await mkdir(path.join(outDir, "data", "seed"), { recursive: true });
await mkdir(path.join(outDir, "export"), { recursive: true });
await mkdir(path.join(outDir, "receipts"), { recursive: true });

await cp(path.join(root, "pack-out/app/server.mjs"), path.join(outDir, "app/server.mjs"));
await cp(path.join(root, "public"), path.join(outDir, "public"), { recursive: true });
await cp(path.join(root, "START-EMERGENCY.bat"), path.join(outDir, "START-EMERGENCY.bat"));
await cp(path.join(root, "START-EMERGENCY.sh"), path.join(outDir, "START-EMERGENCY.sh"));
await cp(path.join(root, "README-OPERATOR.txt"), path.join(outDir, "README-OPERATOR.txt"));
await cp(path.join(root, "STOP.txt"), path.join(outDir, "STOP.txt"));
await writeFile(path.join(outDir, "data/seed/PUT-CARE-USB-SEED-HERE.txt"), "Copy tests.csv, doctors.csv, and CARE_EMERGENCY_MASTER_V1.json from CARE super-admin Download USB seed.\n");

const nodeZipUrl = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;
const nodeZip = path.join(root, "pack-out", `node-win.zip`);
console.log("downloading", nodeZipUrl);
const res = await fetch(nodeZipUrl);
if (!res.ok || !res.body) throw new Error(`node download failed ${res.status}`);
await pipeline(res.body, createWriteStream(nodeZip));
await run("unzip", ["-o", "-q", nodeZip, `node-v${NODE_VERSION}-win-x64/node.exe`, "-d", path.join(root, "pack-out")]);
await cp(
  path.join(root, "pack-out", `node-v${NODE_VERSION}-win-x64`, "node.exe"),
  path.join(outDir, "runtime", "node.exe"),
);

await run("zip", ["-r", "-q", zipPath, "CARE-ULTRA-EMERGENCY"], path.join(root, "pack-out"));
console.log("wrote", zipPath);
