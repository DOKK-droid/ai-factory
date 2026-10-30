import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO = path.resolve(new URL('..', import.meta.url).pathname);
export const tmp = (p = 'af-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
export const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

/** Repo temporal con rama main y una rama `feat` con cambios. */
export function makeRepo() {
  const dir = tmp('af-repo-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  write(path.join(dir, 'src/app.js'), 'export const a = 1;\n');
  write(path.join(dir, 'tests/app.test.js'), "test('a', () => { expect(1 + 1).toBe(2); });\n");
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'feat');
  return dir;
}
export const commitAll = (dir, msg = 'change') => { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', msg); };
