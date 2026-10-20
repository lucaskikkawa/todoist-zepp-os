import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const roots = ['app.js', 'app-side', 'page', 'setting', 'shared', 'scripts', 'tests'];
let failures = 0;
function scan(path) {
  if (!/\.(?:js|mjs)$/.test(path)) {
    try { for (const entry of readdirSync(path, { withFileTypes: true })) scan(`${path}/${entry.name}`); } catch { /* absent optional folder */ }
    return;
  }
  const content = readFileSync(path, 'utf8');
  const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (check.status !== 0) { process.stderr.write(check.stderr); failures++; }
  if (!path.startsWith('tests/') && /console\.(?:log|error|warn|debug)\s*\(/.test(content)) {
    process.stderr.write(`${path}: logging is disabled to protect account data\n`); failures++;
  }
}
roots.forEach(scan);
if (failures) process.exit(1);
process.stdout.write('Sintaxe JavaScript e política de logs: OK\n');
