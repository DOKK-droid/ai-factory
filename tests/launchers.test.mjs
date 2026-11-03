import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../', import.meta.url).pathname;

function runLauncher(name, env = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'factory-launchers-'));
  const fake = join(bin, 'opencode');
  writeFileSync(fake, `#!/usr/bin/env bash
printf '%s|%s|%s|%s|%s|%s\\n' "$FACTORY_GUARD_ALLOW_PROTECTED_EDIT" "\${GIT_AUTHOR_NAME-}" "\${GIT_AUTHOR_EMAIL-}" "\${GIT_COMMITTER_NAME-}" "\${GIT_COMMITTER_EMAIL-}" "$*"
`);
  chmodSync(fake, 0o755);
  return spawnSync(join(root, name), ['--version'], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
    encoding: 'utf8',
  });
}

test('factory-agent uses agent Git identity and never enables protected edits', () => {
  const result = runLauncher('factory-agent', {
    FACTORY_GUARD_ALLOW_PROTECTED_EDIT: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    '|factory-agent|factory-agent@users.noreply.github.com|factory-agent|factory-agent@users.noreply.github.com|--version',
  );
});

test('factory-maint enables protected edits and clears factory-agent Git identity', () => {
  const result = runLauncher('factory-maint', {
    GIT_AUTHOR_NAME: 'factory-agent',
    GIT_AUTHOR_EMAIL: 'factory-agent@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'factory-agent',
    GIT_COMMITTER_EMAIL: 'factory-agent@users.noreply.github.com',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '1|||||--version');
});

test('AGENTS.md contains the mandatory conduct rule', () => {
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /## Regla de conducta \(obligatoria\)/);
  assert.match(agents, /DETENTE/);
  assert.match(agents, /Una rama = un tema = un PR \(factory\/<job-id>\)/);
});
