// Trazabilidad: las plantillas y los prompts de los agentes piden `Implementa:` y explican la realineacion, y ningun agente
// puede escribir implementa.lock (lo escribe `project-lint stamp`, que solo acepta una confirmacion nueva del humano).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('plantillas: el spec y la página del job piden Implementa', () => {
  const tpl = read('02-DOCS/wiki/sdd/spec-template.md');
  assert.match(tpl, /- RF-1: .*Implementa: REQ-F-1/); assert.match(tpl, /Implementa:.*(cada RF|obligatori)/is); assert.match(tpl, /implementa\.lock/);
  const page = read('02-DOCS/wiki/sdd/job-page-template.md');
  assert.match(page, /^Implementa: .*REQ-F-1/m); assert.match(page, /unión/);
});
test('prompts: spec-writer y memory-curator saben qué es Implementa; el spec-writer sabe realinear y que debe modificar spec.md', () => {
  const sw = read('.opencode/agent/spec-writer.md');
  assert.match(sw, /Implementa: REQ-F-n, UC-n/); assert.match(sw, /## Realineación/); assert.match(sw, /modifica `spec\.md` siempre/); assert.match(sw, /No escribas `implementa\.lock`/);
  assert.match(read('.opencode/agent/memory-curator.md'), /línea `Implementa: <unión exacta/);
});

function perms(agent) {
  const fm = read(`.opencode/agent/${agent}.md`).split('\n---\n')[0].split('\n');
  const out = { edit: [], flat: {} }; let sec = null;
  for (const l of fm) { let m = l.match(/^  (\w+):\s*(\w+)?$/); if (m) { sec = m[1]; if (m[2]) out.flat[sec] = m[2]; continue; } m = l.match(/^    "([^"]+)":\s*(\w+)$/); if (m && sec === 'edit') out.edit.push([m[1], m[2]]); }
  return out;
}
const rx = (pat) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 's');
const canEdit = (agent, file) => { const p = perms(agent); if (p.flat.edit) return p.flat.edit; return p.edit.reduce((acc, [pat, a]) => (rx(pat).test(file) ? a : acc), 'ask'); };
const AGENTS = fs.readdirSync(path.join(REPO, '.opencode/agent')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));

test('ningún agente de la fábrica puede escribir implementa.lock (ni crear spec.ok): el lock lo escribe stamp', () => {
  assert.ok(AGENTS.length >= 17, AGENTS.join());
  for (const a of AGENTS) for (const f of ['/r/factory/jobs/job-1/implementa.lock', 'factory/jobs/job-1/implementa.lock']) assert.notEqual(canEdit(a, f), 'allow', `${a} -> ${f}`);
});
