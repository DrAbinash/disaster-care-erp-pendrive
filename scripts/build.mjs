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
  // Only shim `require` for CJS deps. Do NOT declare `__dirname`/`__filename`
  // here — esbuild already injects those for ESM output, and a second
  // declaration crashes Node with "Identifier '__dirname' has already been declared".
  banner: {
    js: `import { createRequire as __pendriveCreateRequire } from "node:module";
const require = __pendriveCreateRequire(import.meta.url);
`,
  },
  alias: {
    "@workspace/emergency-billing": path.join(root, "lib/emergency-billing/src/index.ts"),
  },
});

console.log("built pack-out/app/server.mjs");
