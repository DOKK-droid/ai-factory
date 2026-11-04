import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO, write, run, git, makeRepo, commitAll } from './helpers.mjs';
import { parseScope, globToRegExp, checkScope, parseChanges } from '../factory/scripts/scope-check.mjs';

test('parseScope: lee la lista bajo "Alcance:" y se detiene al terminar', () => {
  const s = parseScope('# Spec\nSurface: none\n\nAlcance:\n- src/**\n- `tests/a.test.js`\n\n1. criterio\n- otra cosa');
  assert.deepEqual(s, { found: true, globs: ['src/**', 'tests/a.test.js'] });
  assert.equal(parseScope('sin seccion').found, false);
});
test('globToRegExp: ** cruza carpetas, * no, directorios con /', () => {
  const m = (g, p) => globToRegExp(g).test(p);
  assert.ok(m('src/**', 'src/a/b.js') && m('src/**', 'src/a.js') && !m('src/**', 'srcx/a.js'));
  assert.ok(m('src/*.js', 'src/a.js') && !m('src/*.js', 'src/a/b.js'));
  assert.ok(m('docs/', 'docs/x/y.md') && m('**/*.test.js', 'tests/deep/a.test.js') && m('**/*.test.js', 'a.test.js'));
  assert.ok(m('a.b', 'a.b') && !m('a.b', 'axb'));
});
test('checkScope: fuera de alcance, borrados ajenos y alcance demasiado amplio', () => {
  const ch = parseChanges('A\tsrc/a.js\nM\tsrc/b.js\nD\t.agents/skills/x/SKILL.md\nM\topencode.json');
  const r = checkScope(['src/**'], ch);
  assert.deepEqual(r.out, ['opencode.json']); assert.deepEqual(r.delOut, ['.agents/skills/x/SKILL.md']); assert.equal(r.broad, false);
  assert.equal(checkScope(['**'], ch).broad, true); assert.equal(checkScope([], ch).broad, true);
});
test('CLI changes: incluye commits, cambios sin commitear y archivos nuevos', () => {
  const d = makeRepo();
  write(path.join(d, 'src/new.js'), 'x'); commitAll(d, 'c1');
  write(path.join(d, 'src/app.js'), 'export const a = 2;\n');           // modificado sin commitear
  write(path.join(d, 'untracked.txt'), 'u');                             // sin seguimiento
  git(d, 'rm', '-q', 'tests/app.test.js');                              // borrado
  const mb = git(d, 'merge-base', 'main', 'HEAD').trim();
  const out = run('node', [path.join(REPO, 'factory/scripts/scope-check.mjs'), 'changes', mb], { cwd: d }).stdout.trim().split('\n').sort();
  assert.deepEqual(out, ['A\tsrc/new.js', 'A\tuntracked.txt', 'D\ttests/app.test.js', 'M\tsrc/app.js']);
});
test('CLI check: codigos de salida 0 / 1 / 2', () => {
  const d = makeRepo();
  const spec = path.join(d, 'spec.md');
  const chk = (text, input) => { write(spec, text); return run('node', [path.join(REPO, 'factory/scripts/scope-check.mjs'), 'check', spec], { input }); };
  assert.equal(chk('Alcance:\n- src/**\n', 'M\tsrc/a.js\n').status, 0);
  const v = chk('Alcance:\n- src/**\n', 'M\topencode.json\nD\tpatch-refactor/x.md\n');
  assert.equal(v.status, 1); assert.match(v.stdout, /FUERA_DE_ALCANCE\topencode.json/); assert.match(v.stdout, /BORRADO_FUERA_DE_ALCANCE\tpatch-refactor\/x.md/);
  assert.equal(chk('# sin alcance\n', 'M\tsrc/a.js\n').status, 2);
  assert.equal(chk('Alcance:\n- **\n', 'M\tsrc/a.js\n').status, 2);
});
