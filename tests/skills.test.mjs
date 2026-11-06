// Una skill vive en un solo sitio (ADR-011): de terceros en .agents/skills (fijadas por skills-lock.json), propias de la fabrica en 03-SKILLS.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';

const dirs = (d) => (fs.existsSync(path.join(REPO, d)) ? fs.readdirSync(path.join(REPO, d), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);

test('ninguna skill esta duplicada entre .agents/skills y 03-SKILLS', () => {
  const third = dirs('.agents/skills'); const own = dirs('03-SKILLS');
  assert.ok(third.length >= 4 && own.length >= 6);
  assert.deepEqual(third.filter((n) => own.includes(n)), [], 'skills con el mismo nombre en las dos rutas');
});

test('cada skill de terceros esta fijada en skills-lock.json y cada skill propia tiene SKILL.md', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'skills-lock.json'), 'utf8')).skills;
  for (const n of dirs('.agents/skills')) assert.ok(lock[n], `${n} no esta en skills-lock.json`);
  for (const n of dirs('03-SKILLS')) assert.ok(fs.existsSync(path.join(REPO, '03-SKILLS', n, 'SKILL.md')), `03-SKILLS/${n} sin SKILL.md`);
});

test('toda ruta 03-SKILLS/<skill> citada por un agente existe', () => {
  const agents = path.join(REPO, '.opencode/agent');
  for (const f of fs.readdirSync(agents).filter((x) => x.endsWith('.md'))) {
    for (const m of fs.readFileSync(path.join(agents, f), 'utf8').matchAll(/03-SKILLS\/([A-Za-z0-9_-]+)/g)) assert.ok(dirs('03-SKILLS').includes(m[1]), `${f} cita 03-SKILLS/${m[1]}, que no existe`);
  }
});
