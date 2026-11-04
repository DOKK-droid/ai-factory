import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, run } from './helpers.mjs';

const INSTALL = path.join(REPO, 'factory/scripts/install-managed.sh');
const TEMPLATE = path.join(REPO, 'factory/templates/managed-opencode.json');
const bash = () => JSON.parse(fs.readFileSync(TEMPLATE, 'utf8')).permission.bash;

/** Evalua como se asume que hace OpenCode: gana la ULTIMA regla que coincide; "cmd *" tambien cubre "cmd" sin argumentos. */
function decide(rules, cmd) {
  let out = 'ask';
  for (const [pat, act] of Object.entries(rules)) {
    const re = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/ \*$/, '( .*)?').replace(/\*/g, '.*') + '$');
    if (re.test(cmd)) out = act;
  }
  return out;
}
test('plantilla managed: el unico push permitido es a factory/* y nunca con force/delete/mirror', () => {
  const r = bash();
  assert.equal(decide(r, 'git push -u origin factory/job-1'), 'allow');
  for (const c of ['git push', 'git push origin main', 'git push -u origin main', 'git push --force origin factory/x',
    'git push -u origin factory/x --force', 'git push -u origin factory/x --delete', 'git push -f origin main', 'git push --mirror', 'git push origin +factory/x'])
    assert.equal(decide(r, c), 'deny', c);
});
test('plantilla managed: merge, reset --hard, gh api, pr merge, rm -rf y tokens denegados', () => {
  const r = bash();
  for (const c of ['git merge x', 'git reset --hard HEAD~1', 'git clean -fd', 'gh pr merge 5', 'gh pr ready 3', 'gh api -X PUT repos/o/r', 'gh auth token', 'rm -rf /tmp/x', 'printenv GH_TOKEN'])
    assert.equal(decide(r, c), 'deny', c);
  for (const c of ['git status', 'gh pr create --draft --title x']) assert.notEqual(decide(r, c), 'deny', c);
});
test('plantilla managed: el allow de factory/* va DESPUES de los deny de push (gana la ultima regla)', () => {
  const keys = Object.keys(bash());
  assert.ok(keys.indexOf('git push -u origin factory/*') > keys.indexOf('git push *'));
  assert.ok(keys.indexOf('git push *--force*') > keys.indexOf('git push -u origin factory/*'));
});
test('plantilla managed: .env denegado en lectura', () => {
  const read = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8')).permission.read;
  assert.equal(read['*.env'], 'deny'); assert.equal(read['*.env.example'], 'allow');
});

const inst = (args, dir, extra = {}) => run('bash', [INSTALL, ...args], { env: { ...process.env, FACTORY_MANAGED_DIR: dir, FACTORY_MANAGED_OWNER: '', SUDO: '', ...extra } });
test('instalador: dry-run no escribe; --apply instala, --check compara, reinstalar deja copia, --uninstall retira', () => {
  const dir = path.join(tmp('af-mg-'), 'etc-opencode'); const target = path.join(dir, 'opencode.json');
  const dry = inst([], dir); assert.equal(dry.status, 0); assert.match(dry.stdout, /\[dry-run\]/); assert.equal(fs.existsSync(target), false);
  assert.equal(inst(['--check'], dir).status, 1);
  assert.equal(inst(['--apply'], dir).status, 0); assert.equal(fs.readFileSync(target, 'utf8'), fs.readFileSync(TEMPLATE, 'utf8'));
  assert.equal(inst(['--check'], dir).status, 0);
  fs.writeFileSync(target, '{"permission":{}}\n');                                   // alguien lo cambia
  assert.equal(inst(['--check'], dir).status, 1);
  assert.equal(inst(['--apply'], dir).status, 0); assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('opencode.json.bak-')));
  assert.equal(inst(['--uninstall', '--apply'], dir).status, 0); assert.equal(fs.existsSync(target), false);
});
test('instalador: opcion desconocida => error', () => assert.notEqual(inst(['--rm-rf'], tmp('af-mg-')).status, 0));
