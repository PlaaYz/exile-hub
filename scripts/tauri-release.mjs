// After `tauri build`: puts the signed installer in release/ under a space-free name and writes both
// update manifests for it:
//   latest.json  Tauri updater (Tauri installs)            signature from the .sig file
//   latest.yml   electron-updater (Electron 0.2.x installs) sha512 + size: moves them to Tauri
// Usage: node scripts/tauri-release.mjs ["release notes"]
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const bundle = path.join(root, "src-tauri/target/release/bundle/nsis");
const src = path.join(bundle, `Exile Hub_${version}_x64-setup.exe`);
const name = `ExileHub-Setup-${version}.exe`;
const out = path.join(root, "release");
const dest = path.join(out, name);
const url = `https://github.com/PlaaYz/exile-hub/releases/download/v${version}/${name}`;
const now = new Date().toISOString();

mkdirSync(out, { recursive: true });
copyFileSync(src, dest);
const signature = readFileSync(`${src}.sig`, "utf8").trim();
writeFileSync(`${dest}.sig`, signature);

const latestJson = {
  version,
  notes: process.argv[2] || `Exile Hub ${version}`,
  pub_date: now,
  platforms: { "windows-x86_64": { signature, url } },
};
writeFileSync(path.join(out, "latest.json"), JSON.stringify(latestJson, null, 2));

const sha512 = createHash("sha512").update(readFileSync(dest)).digest("base64");
const size = statSync(dest).size;
const latestYml = [
  `version: ${version}`,
  "files:",
  `  - url: ${name}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${name}`,
  `sha512: ${sha512}`,
  `releaseDate: '${now}'`,
  "",
].join("\n");
writeFileSync(path.join(out, "latest.yml"), latestYml);

console.log(`release/${name} (${(size / 1048576).toFixed(1)} MB), release/latest.json, release/latest.yml`);
