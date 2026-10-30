import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, run } from './helpers.mjs';

const SCRIPT = path.join(REPO, 'factory/scripts/onboard-project.sh');

/** `gh` simulado: registra argumentos y copia el --input; GH_EXISTING=1 simula un ruleset existente (id 42). */
function stub() {
  const d = tmp('af-gh-'); const bin = path.join(d, 'gh');
  write(bin, `#!/usr/bin/env bash
echo "$*" >> "${d}/log"
for ((i=1;i<=$#;i++)); do if [ "\${!i}" = "--input" ]; then j=$((i+1)); cp "\${!j}" "${d}/input.json"; fi; done
if [[ "$*" == *"rulesets --jq"* && -n "\${GH_EXISTING:-}" ]]; then echo 42; fi
exit 0
`);
  fs.chmodSync(bin, 0o755);
  return { bin, log: () => (fs.existsSync(`${d}/log`) ? fs.readFileSync(`${d}/log`, 'utf8') : ''), input: () => JSON.parse(fs.readFileSync(`${d}/input.json`, 'utf8')) };
}
const go = (args, env = {}) => { const s = stub(); const r = run('bash', [SCRIPT, ...args], { env: { ...process.env, GH_BIN: s.bin, ...env } }); return { ...r, s }; };

test('dry-run por defecto: no llama a gh', () => {
  const r = go(['o/r']);
  assert.equal(r.status, 0); assert.equal(r.s.log(), ''); assert.match(r.stdout, /\[dry-run\]/);
});
test('--apply crea el ruleset con el check y las aprobaciones indicadas', () => {
  const r = go(['o/r', '--check-name', 'behavior-tests', '--approvals', '1', '--code-owners', '--apply']);
  assert.equal(r.status, 0, r.stderr);
  const log = r.s.log();
  assert.match(log, /api -X PATCH repos\/o\/r .*allow_merge_commit=false.*allow_auto_merge=false/);
  assert.match(log, /secret_scanning_push_protection\]\[status\]=enabled/);
  assert.match(log, /actions\/permissions\/workflow .*can_approve_pull_request_reviews=false/);
  assert.match(log, /api -X POST repos\/o\/r\/rulesets --input/);
  const j = r.s.input();
  assert.equal(j.enforcement, 'active'); assert.deepEqual(j.bypass_actors, []);
  assert.deepEqual(j.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks, [{ context: 'behavior-tests' }]);
  const pr = j.rules.find((x) => x.type === 'pull_request').parameters;
  assert.equal(pr.required_approving_review_count, 1); assert.equal(pr.require_code_owner_review, true);
  assert.deepEqual(pr.allowed_merge_methods, ['squash']);
});
test('si el ruleset ya existe, lo actualiza con PUT', () => {
  const r = go(['o/r', '--apply'], { GH_EXISTING: '1' });
  assert.match(r.s.log(), /api -X PUT repos\/o\/r\/rulesets\/42 --input/);
  assert.doesNotMatch(r.s.log(), /-X POST repos\/o\/r\/rulesets/);
});
test('valida entradas: repo, aprobaciones y nombre del check', () => {
  assert.notEqual(go(['no-es-un-repo']).status, 0);
  assert.notEqual(go(['o/r', '--approvals', 'x']).status, 0);
  assert.notEqual(go(['o/r', '--check-name', 'a;rm -rf /']).status, 0);
  assert.notEqual(go(['o/r', '--opcion-rara']).status, 0);
});
test('plantillas: JSON valido, sin bypass y con squash', () => {
  const j = JSON.parse(fs.readFileSync(path.join(REPO, 'factory/templates/ruleset-main.json'), 'utf8'));
  assert.deepEqual(j.bypass_actors, []);
  assert.ok(j.rules.some((x) => x.type === 'deletion') && j.rules.some((x) => x.type === 'non_fast_forward'));
});
