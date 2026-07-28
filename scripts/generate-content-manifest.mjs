import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");
const rulesDir = join(root, "rules");
const manifestPath = join(skillsDir, "manifest.json");

function hash(filePath) {
  const content = readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let previous = { skills: {}, rules: {} };
try {
  previous = JSON.parse(readFileSync(manifestPath, "utf-8"));
} catch {}

const manifest = { schema: 1, skills: {}, rules: {} };

for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join(skillsDir, entry.name);
  const files = walk(dir)
    .map((file) => ({ path: relative(dir, file).split(sep).join("/"), hash: hash(file) }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));

  const prev = previous.skills?.[entry.name];
  const changed = !prev || JSON.stringify(prev.files) !== JSON.stringify(files);
  manifest.skills[entry.name] = {
    revision: changed ? (prev?.revision ?? 0) + 1 : prev.revision,
    minCliVersion: prev?.minCliVersion ?? "0.0.0",
    files,
  };
}

for (const name of readdirSync(rulesDir)
  .filter((file) => file.endsWith(".md"))
  .sort()) {
  const fileHash = hash(join(rulesDir, name));
  const prev = previous.rules?.[name];
  const changed = !prev || prev.hash !== fileHash;
  manifest.rules[name] = {
    revision: changed ? (prev?.revision ?? 0) + 1 : prev.revision,
    minCliVersion: prev?.minCliVersion ?? "0.0.0",
    hash: fileHash,
  };
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${relative(root, manifestPath)}`);
