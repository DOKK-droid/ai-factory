import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { REPO, tmp, write, run, makeRepo, commitAll } from './helpers.mjs';

const LAUNCH = path.join(REPO, '01-TOOLS/launch-reviewers.sh');
const MODEL = { security: 'p/sec', ux: 'p/ux', ui: 'p/ui', code: 'p/code' };

const STUB = `#!/usr/bin/env bash
LOG="\${STUB_LOG:?}"
if [ "$1" = "models" ]; then cat "\${STUB_MODELS:?}"; exit 0; fi
agent=""; prompt="\${@: -1}"
for ((i=1;i<=$#;i++)); do [ "\${!i}" = "--agent" ] && { j=$((i+1)); agent="\${!j}"; }; done
echo "start $agent $(date +%s.%N)" >> "$LOG/events"
printf '%s' "$prompt" > "$LOG/prompt-$agent.txt"
printf '%s\\n' "$*" | head -c 300 > "$LOG/args-$agent.txt"
n=$(( $(cat "$LOG/count-$agent" 2>/dev/null || echo 0) + 1 )); echo $n > "$LOG/count-$agent"
var="STUB_MODE_$(echo "$agent" | tr 'a-z-' 'A-Z_')"; mode="\${!var:-\${STUB_MODE:-ok}}"
ok() { printf 'VERDICT: PASS\\nSCORE: 0.9\\n\\nSin hallazgos.\\n'; }
case "$mode" in
  ok) ok ;;
  slow) sleep 1; ok ;;
  fenced) printf '\`\`\`\\nVERDICT: CHANGES\\nSCORE: 0.4\\n\`\`\`\\nhallazgo: src/a.js:1\\n' ;;
  nofmt) echo "Todo me parece bien, no veo problemas." ;;
  nofmt_then_ok) if [ "$n" -eq 1 ]; then echo "texto libre"; else ok; fi ;;
  fail) echo "boom" >&2; exit 1 ;;
  hang) sleep 600 ;;
esac
echo "end $agent $(date +%s.%N)" >> "$LOG/events"
`;

function setup({ gate = 'GATE: PASS\n', models = Object.values(MODEL), agentModels = MODEL } = {}) {
  const extra = { '.gitignore': 'jobs/\nlogs/\n' };
  for (const [r, m] of Object.entries(agentModels)) extra[`.opencode/agent/reviewer-${r}.md`] = `---\ndescription: x\nmodel: ${m}\n---\ncuerpo\n`;
  const repo = makeRepo(extra);
  write(path.join(repo, 'src/feature.js'), 'export const marker = "MARKER_DIFF_LINE";\n'); commitAll(repo, 'job');
  const job = path.join(repo, 'jobs/j1');
  write(path.join(job, 'spec.md'), '# Spec MARKER_SPEC\nSurface: none\n\nAlcance:\n- src/**\n\n1. criterio\n');
  write(path.join(job, 'build.md'), 'BUILD_PROSE_MARKER: todo verde, 4/4 tests\n');
  if (gate !== null) write(path.join(job, 'gate.md'), gate);
  const logs = tmp('af-stub-'); const bin = path.join(logs, 'opencode'); fs.writeFileSync(bin, STUB); fs.chmodSync(bin, 0o755);
  write(path.join(logs, 'models.txt'), `Available models\n${models.join('\n')}\nother/model\n`);
  return { repo, job, logs, bin };
}
function launch(s, env = {}, args = ['j1']) {
  return run('bash', [LAUNCH, ...args], { cwd: s.repo, timeout: 120000, env: { ...process.env, OPENCODE_BIN: s.bin, STUB_LOG: s.logs, STUB_MODELS: path.join(s.logs, 'models.txt'),
    FACTORY_BASE: 'main', FACTORY_JOBS_DIR: path.join(s.repo, 'jobs'), REVIEW_POLL_SECS: '1', REVIEW_MAX_PARALLEL: '4', ...env } });
}
const review = (s, role, round = 1) => fs.readFileSync(path.join(s.job, `round-${round}`, `review-${role}.md`), 'utf8');
const prompt = (s, role) => fs.readFileSync(path.join(s.logs, `prompt-reviewer-${role}.txt`), 'utf8');

test('flujo normal: 4 reviews validos escritos POR EL SCRIPT; el prompt lleva el DIFF REAL y NO la prosa del builder', () => {
  const s = setup(); const r = launch(s);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const role of Object.keys(MODEL)) {
    assert.match(review(s, role), /^VERDICT: PASS\nSCORE: 0\.9/);
    const p = prompt(s, role);
    assert.match(p, /MARKER_DIFF_LINE/); assert.match(p, /MARKER_SPEC/); assert.match(p, /GATE: PASS/);
    assert.doesNotMatch(p, /BUILD_PROSE_MARKER/);
  }
  assert.match(fs.readFileSync(path.join(s.logs, 'args-reviewer-code.txt'), 'utf8'), /--model p\/code/);
});
test('no lanza nada si el gate no paso o falta', () => {
  for (const gate of ['GATE: FAIL\n', null]) {
    const s = setup({ gate }); const r = launch(s);
    assert.notEqual(r.status, 0); assert.equal(fs.existsSync(path.join(s.logs, 'events')), false);
  }
});
test('un review VIEJO no sobrevive: si el reviewer falla queda un review fail-closed, no el PASS antiguo', () => {
  const s = setup();
  write(path.join(s.job, 'round-1/review-code.md'), 'VERDICT: PASS\nSCORE: 1\n\nviejo\n');
  const r = launch(s, { STUB_MODE_REVIEWER_CODE: 'fail', REVIEW_RETRIES: '0' }, ['j1', '1']);
  assert.equal(r.status, 3);
  assert.match(review(s, 'code'), /^VERDICT: CHANGES\nSCORE: 0\n/); assert.match(review(s, 'code'), /REVIEWER_FALLO/);
  assert.match(review(s, 'security'), /^VERDICT: PASS/);
});
test('formato malo => 1 reintento; si el reintento acierta, queda su review', () => {
  const s = setup(); const r = launch(s, { STUB_MODE_REVIEWER_UX: 'nofmt_then_ok' });
  assert.equal(r.status, 0, r.stdout); assert.match(review(s, 'ux'), /^VERDICT: PASS/);
  assert.equal(fs.readFileSync(path.join(s.logs, 'count-reviewer-ux'), 'utf8').trim(), '2'); assert.match(prompt(s, 'ux'), /no cumplio el formato/);
});
test('formato malo siempre => CHANGES / SCORE 0 (falla cerrado) y codigo 3', () => {
  const s = setup(); const r = launch(s, { STUB_MODE_REVIEWER_UI: 'nofmt' });
  assert.equal(r.status, 3); assert.match(review(s, 'ui'), /^VERDICT: CHANGES\nSCORE: 0\n/);
});
test('limpia vallas ``` y texto previo de la respuesta del modelo', () => {
  const s = setup(); launch(s, { STUB_MODE_REVIEWER_SECURITY: 'fenced' });
  assert.match(review(s, 'security'), /^VERDICT: CHANGES\nSCORE: 0\.4\n/); assert.doesNotMatch(review(s, 'security'), /```/);
});
test('vigilante por inactividad: mata al reviewer colgado y sigue con los demas', () => {
  const s = setup(); const t0 = Date.now();
  const r = launch(s, { STUB_MODE_REVIEWER_CODE: 'hang', REVIEW_IDLE_SECS: '2', REVIEW_RETRIES: '0' });
  assert.equal(r.status, 3); assert.match(review(s, 'code'), /inactivo 2s/); assert.match(review(s, 'security'), /^VERDICT: PASS/);
  assert.ok(Date.now() - t0 < 60000);
});
test('timeout total: corta aunque haya actividad', () => {
  const s = setup(); const r = launch(s, { STUB_MODE_REVIEWER_CODE: 'hang', REVIEW_TIMEOUT_SECS: '2', REVIEW_IDLE_SECS: '0', REVIEW_RETRIES: '0' });
  assert.equal(r.status, 3); assert.match(review(s, 'code'), /timeout total 2s/);
});
test('NO mata procesos ajenos (el pkill -f "opencode run" anterior los mataba)', async () => {
  const s = setup();
  const decoy = spawn('bash', ['-c', 'exec -a "opencode run decoy-de-otro-proyecto" sleep 120'], { detached: true, stdio: 'ignore' }); decoy.unref();
  await new Promise((r) => setTimeout(r, 300));
  const r = launch(s); assert.equal(r.status, 0);
  let alive = true; try { process.kill(decoy.pid, 0); } catch { alive = false; }
  try { process.kill(decoy.pid, 'SIGKILL'); } catch {}
  assert.equal(alive, true);
});
test('paralelismo limitado a REVIEW_MAX_PARALLEL', () => {
  const s = setup(); const r = launch(s, { STUB_MODE: 'slow', REVIEW_MAX_PARALLEL: '2' });
  assert.equal(r.status, 0, r.stdout);
  let cur = 0, max = 0;
  for (const l of fs.readFileSync(path.join(s.logs, 'events'), 'utf8').trim().split('\n').sort((a, b) => a.split(' ')[2] - b.split(' ')[2])) { cur += l.startsWith('start') ? 1 : -1; max = Math.max(max, cur); }
  assert.ok(max <= 2, `max concurrentes ${max}`); assert.equal(fs.readFileSync(path.join(s.logs, 'events'), 'utf8').match(/^start/gm).length, 4);
});
test('modelo inexistente => aborta ANTES de lanzar; FACTORY_SKIP_MODEL_CHECK=1 lo permite', () => {
  const s = setup({ models: ['p/sec', 'p/ux', 'p/ui'] }); const r = launch(s);
  assert.notEqual(r.status, 0); assert.match(r.stderr + r.stdout, /NO EXISTE.*p\/code/); assert.equal(fs.existsSync(path.join(s.logs, 'events')), false);
  assert.equal(launch(s, { FACTORY_SKIP_MODEL_CHECK: '1' }).status, 0);
});
test('diff grande se trunca con aviso explicito', () => {
  const s = setup(); launch(s, { REVIEW_MAX_DIFF_BYTES: '40' });
  assert.match(prompt(s, 'code'), /DIFF TRUNCADO/);
});
test('el round avanza solo (round-1, round-2) y conserva el contexto de cada uno', () => {
  const s = setup(); launch(s); launch(s);
  assert.ok(fs.existsSync(path.join(s.job, 'round-2/review-code.md'))); assert.ok(fs.existsSync(path.join(s.job, 'round-1/context.md')));
});
