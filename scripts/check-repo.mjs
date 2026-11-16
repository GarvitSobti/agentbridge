import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A dependency-free check for the documentation foundation, not a runtime test.
const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['.git', 'node_modules', 'dist', 'coverage', '.agent-bridge']);
const files = [];
async function walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
    else if (entry.isFile()) files.push(relative);
  }
}
await walk(root);
const known = new Set(files);
const problems = [];
const required = [
  'README.md', 'AGENTS.md', 'codex.md', 'AI_MEMORY.md', 'LICENSE',
  'CONTRIBUTING.md', 'SECURITY.md', 'docs/SCOPE.md', 'docs/ARCHITECTURE.md',
  'docs/DECISIONS.md', 'docs/ROADMAP.md', 'docs/VALIDATION.md',
  '.gitignore', '.gitattributes', '.editorconfig', '.nvmrc', 'package.json',
  '.github/workflows/repository-checks.yml',
];
for (const file of required) {
  if (!known.has(file)) problems.push(`Missing required file: ${file}`);
}

let checkedLinks = 0;
let markdownFiles = 0;
for (const file of files.filter((name) => name.endsWith('.md'))) {
  markdownFiles++;
  const source = await readFile(path.join(root, file), 'utf8');
  if (!source.trim()) problems.push(`${file}: empty documentation file`);
  if (!source.endsWith('\n')) problems.push(`${file}: missing final newline`);
  if (/\b(?:TODO|FIXME|TBD)\b/.test(source)) problems.push(`${file}: unresolved placeholder`);
  // This repository uses inline Markdown links. Ignore code examples and anchors.
  const prose = source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  for (const match of prose.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
    const local = decodeURIComponent(target.split(/[?#]/)[0]);
    if (!local) continue;
    checkedLinks++;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), local));
    if (local.startsWith('/') || resolved.startsWith('../') || !known.has(resolved)) {
      problems.push(`${file}: broken or nonportable local link: ${target}`);
    }
  }
}

const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (metadata.private !== true) problems.push('package.json: keep the unpublished foundation private');
if (metadata.scripts?.check !== 'node scripts/check-repo.mjs') problems.push('package.json: unexpected check command');
const dependencies = Object.keys(metadata.dependencies ?? {}).length + Object.keys(metadata.devDependencies ?? {}).length;

if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exitCode = 1;
} else {
  console.log(`Repository checks passed: ${markdownFiles} Markdown files, ${checkedLinks} local file links, ${required.length} required files, valid package metadata.`);
  console.log(`Package dependencies: ${dependencies}. External URLs and Markdown anchors were not checked. No application runtime tests exist yet.`);
}
