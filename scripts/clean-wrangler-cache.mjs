import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const wranglerTmpDir = path.join(repoRoot, '.wrangler', 'tmp');

if (existsSync(wranglerTmpDir)) {
  rmSync(wranglerTmpDir, { recursive: true, force: true });
  console.log(`Removed Wrangler temp cache: ${wranglerTmpDir}`);
} else {
  console.log(`Wrangler temp cache not found: ${wranglerTmpDir}`);
}