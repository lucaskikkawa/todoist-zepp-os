import { cpSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function prepareProduction() {
  const stage = resolve(root, 'build/source');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const path of ['app.js', 'app.json', 'package.json', 'app-side', 'page', 'setting', 'shared', 'assets']) {
    cpSync(resolve(root, path), resolve(stage, path), { recursive: true });
  }
  symlinkSync(resolve(root, 'node_modules'), resolve(stage, 'node_modules'), 'junction');
  return stage;
}
