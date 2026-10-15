import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.resolve(backendDir, '../.env') });
const prismaBin = path.resolve(backendDir, 'node_modules/.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
const result = spawnSync(prismaBin, process.argv.slice(2), {
  cwd: backendDir,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
