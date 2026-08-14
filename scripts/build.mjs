import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "src/server.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: path.join(root, "pack-out/app/server.mjs"),
  packages: "bundle",
  banner: {
    js: `import { createRequire as __pendriveCreateRequire } from "node:module";
import { fileURLToPath as __pendriveFileURLToPath } from "node:url";
import { dirname as __pendriveDirname } from "node:path";
const require = __pendriveCreateRequire(import.meta.url);
const __filename = __pendriveFileURLToPath(import.meta.url);
const __dirname = __pendriveDirname(__filename);
`,
  },
  alias: {
    "@workspace/emergency-billing": path.join(root, "lib/emergency-billing/src/index.ts"),
  },
});

console.log("built pack-out/app/server.mjs");
