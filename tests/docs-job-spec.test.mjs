// Perfil `docs` de spec-lint (rama 6): validacion ESTRUCTURAL del spec minimo de un job de documentacion (kind: docs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, run } from './helpers.mjs';
import { makeProject } from './project-fixture.mjs';
import { lint, affectedDocs, isDocsSpec, summary, adr, sinComentarioHtml } from '../factory/scripts/spec-lint.mjs';
import { DOCS, OWNERS } from '../factory/scripts/project-lint.mjs';

const SPEC_LINT = path.join(REPO, 'factory/scripts/spec-lint.mjs');
const TEMPLATE = fs.readFileSync(path.join(REPO, '02-DOCS/wiki/sdd/spec-docs-template.md'), 'utf8');
const blocks = [...TEMPLATE.matchAll(/```markdown\n([\s\S]*?)```/g)].map((m) => m[1]);
const [SPEC, TASKS] = blocks;
const CTX = { docs: DOCS, owners: { ...OWNERS, decisions: 'architect' }, defined: new Set(['REQ-F-1', 'REQ-F-2', 'REQ-NF-1', 'UC-1', 'UC-2', 'ENT-1', 'ENT-2']) };
const probs = (spec = SPEC, tasks = TASKS, ctx = CTX) => lint(spec, tasks, 'docs', ctx);
const sub = (from, to, text = SPEC) => { assert.ok(text.includes(from), `el spec de ejemplo ya no contiene: ${from}`); return text.replace(from, to); };
const without = (heading) => SPEC.replace(new RegExp(`## ${heading}\\n[\\s\\S]*?(?=\\n## |$)`), '');

test('la plantilla viaja con un ejemplo de spec y de tasks que pasan el perfil docs', () => {
  assert.equal(blocks.length, 2, 'la plantilla lleva dos bloques markdown: spec.md y tasks.md');
  assert.deepEqual(probs(), []);
  assert.ok(isDocsSpec(SPEC)); assert.equal(isDocsSpec('# Spec de prueba\nSurface: none\n'), false);
});
test('cada seccion obligatoria ausente o vacia se reporta con su nombre', () => {
  for (const h of ['Objetivo', 'Cambio solicitado', 'Documentos afectados', 'Impacto en jobs', 'Criterios de aceptación', 'Alcance']) {
    assert.ok(probs(without(h)).some((p) => p.includes(h)), `sin ${h}`);
    const vacia = SPEC.replace(new RegExp(`(## ${h}\\n)[\\s\\S]*?(?=\\n## |$)`), '$1\n');
    assert.ok(probs(vacia).some((p) => p.includes(h)), `${h} vacia`);
  }
});
test('Surface debe ser none; la linea ADR es obligatoria; el titulo debe ser de un cambio documental', () => {
  assert.ok(probs(sub('Surface: none', 'Surface: page')).some((p) => /Surface/.test(p)));
  assert.ok(probs(sub('Surface: none\n', '')).some((p) => /Surface/.test(p)));
  assert.ok(probs(sub(/ADR: none[^\n]*\n/.exec(SPEC)[0], '')).some((p) => /ADR/.test(p)));
  assert.ok(probs(sub('# Spec — Cambio documental: cancelar pedidos', '# Spec — cancelar pedidos')).some((p) => /Cambio documental/.test(p)));
  assert.deepEqual(probs(sub('# Spec — Cambio documental', '# Spec - Cambio documental')), []);
});
test('los criterios de aceptacion deben ser numerados', () => {
  const sinNumeros = SPEC.replace(/^\d+\. /gm, '- ');
  assert.ok(probs(sinNumeros).some((p) => /criterios/i.test(p)));
});
test('Alcance: solo rutas de la base; fuera de ella, ** global o escapes se rechazan', () => {
  for (const bad of ['src/**', '**', '02-DOCS/wiki/**', '02-DOCS/wiki/project/../../src/a.js', '/etc/passwd', '02-DOCS/wiki/projectx/a.md', 'factory/jobs/x/spec.md']) {
    const p = probs(sub('- 02-DOCS/wiki/project/**\n', `- 02-DOCS/wiki/project/**\n- ${bad}\n`));
    assert.ok(p.some((x) => /Alcance/.test(x) && x.includes(bad)), `${bad}: ${p.join(' | ')}`);
  }
  assert.ok(probs(sub('- 02-DOCS/wiki/project/**\n', '')).some((p) => /Alcance/.test(p)), 'Alcance sin ninguna ruta');
  assert.deepEqual(probs(sub('- 02-DOCS/wiki/project/**\n', '- 02-DOCS/wiki/project/01-requisitos.md\n- 02-DOCS/wiki/project/02-casos-de-uso.md\n')), []);
});
test('decisions.md solo en Alcance si hay ADR, y un ADR obliga a la fila decisions -> architect', () => {
  const conDecisions = sub('- 02-DOCS/wiki/project/**\n', '- 02-DOCS/wiki/project/**\n- 02-DOCS/wiki/sdd/decisions.md\n');
  assert.ok(probs(conDecisions).some((p) => /decisions\.md/.test(p) && /ADR/.test(p)), 'decisions.md sin ADR');
  const adr = sub('ADR: none', 'ADR: Cancelacion por eventos', conDecisions);
  assert.ok(probs(adr).some((p) => /decisions/.test(p) && /fila/.test(p)), 'ADR sin fila decisions');
  const fila = sub('| ENT-1 | 03-dominio | domain-modeler |', '| ENT-1 | 03-dominio | domain-modeler |\n| nuevo | decisions | architect |', adr);
  assert.ok(probs(fila).some((x) => /tasks\.md/.test(x) && /decisions/.test(x)), 'tasks.md debe nombrar decisions');
  assert.deepEqual(probs(fila, TASKS + '- [ ] T4 (decisions, architect): registrar el ADR\n'), []);
  assert.ok(probs(sub('ADR: none', 'ADR: Cancelacion por eventos')).some((p) => /decisions\.md/.test(p)), 'con ADR, decisions.md debe figurar en Alcance');
});
test('Documentos afectados: documento valido, agente dueño, IDs que existen o "nuevo"', () => {
  assert.ok(probs(sub('| ENT-1 | 03-dominio | domain-modeler |', '| ENT-1 | 07-otro | domain-modeler |')).some((p) => /07-otro/.test(p)));
  assert.ok(probs(sub('| ENT-1 | 03-dominio | domain-modeler |', '| ENT-1 | 03-dominio | system-analyst |')).some((p) => /domain-modeler/.test(p) && /03-dominio/.test(p)));
  assert.ok(probs(sub('| ENT-1 | 03-dominio | domain-modeler |', '| ENT-99 | 03-dominio | domain-modeler |')).some((p) => /ENT-99/.test(p)));
  assert.ok(probs(sub('| ENT-1 | 03-dominio | domain-modeler |', '| ENT-1x | 03-dominio | domain-modeler |')).some((p) => /ENT-1x/.test(p)));
  assert.ok(probs(sub('| ENT-1 | 03-dominio | domain-modeler |', '| quizas | 03-dominio | domain-modeler |')).some((p) => /quizas/.test(p)));
  assert.ok(probs(sub('| REQ-F-1, nuevo |', '| REQ-F-1, REQ-F-77 |')).some((p) => /REQ-F-77/.test(p)));
  assert.deepEqual(probs(sub('| ENT-1 | 03-dominio | domain-modeler |', '| nuevo | 03-dominio | domain-modeler |')), []);
  const sinTabla = SPEC.replace(/\| ID \|[\s\S]*?\n\n/, '\n');
  assert.ok(probs(sinTabla).some((p) => /Documentos afectados/.test(p)));
  assert.deepEqual(probs(SPEC, TASKS, { ...CTX, defined: null }), [], 'sin base conocida no se inventa un error de existencia');
});
test('tasks.md: debe existir y nombrar cada documento afectado', () => {
  assert.ok(probs(SPEC, '').some((p) => /tasks\.md/.test(p)));
  assert.ok(probs(SPEC, TASKS.replace(/^.*03-dominio.*$/m, '- [ ] T3: algo')).some((p) => /03-dominio/.test(p) && /tasks\.md/.test(p)));
});
test('affectedDocs y summary: leen la tabla y el humano ve los documentos que va a confirmar', () => {
  assert.deepEqual(affectedDocs(SPEC).map((r) => [r.ids.join(','), r.doc, r.agent]), [['REQ-F-1,nuevo', '01-requisitos', 'system-analyst'], ['nuevo', '02-casos-de-uso', 'system-analyst'], ['ENT-1', '03-dominio', 'domain-modeler']]);
  const s = summary(SPEC).join('\n'); assert.match(s, /Documentos afectados \(3\)/); assert.match(s, /01-requisitos/); assert.match(s, /03-dominio/);
  assert.deepEqual(affectedDocs('# otro\n'), []);
});

// ---- CLI: perfil docs elegido por argumento, IDs contra la base de --root
test('CLI: spec-lint check <spec> <tasks> docs --root R comprueba los IDs contra la base de R', () => {
  const p = makeProject(); const d = tmp('af-docsspec-'); write(path.join(d, 'spec.md'), SPEC); write(path.join(d, 'tasks.md'), TASKS);
  const ok = run('node', [SPEC_LINT, 'check', path.join(d, 'spec.md'), path.join(d, 'tasks.md'), 'docs', '--root', p.root], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.equal(ok.stdout.trim(), '');
  write(path.join(d, 'spec.md'), sub('| ENT-1 |', '| ENT-42 |'));
  const bad = run('node', [SPEC_LINT, 'check', path.join(d, 'spec.md'), path.join(d, 'tasks.md'), 'docs', '--root', p.root], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.match(bad.stdout, /ENT-42/);
  const std = run('node', [SPEC_LINT, 'check', path.join(d, 'spec.md'), path.join(d, 'tasks.md'), 'standard'], { encoding: 'utf8' });
  assert.equal(std.status, 0, 'el perfil standard sigue sin conocer el perfil docs');
});
test('los perfiles standard y full no cambian por la existencia del perfil docs', () => {
  const std = '# S\nSurface: none\n\n## Criterios\n1. a\n\nAlcance:\n- src/**\n';
  assert.deepEqual(lint(std, '- [ ] t', 'standard'), []);
  assert.ok(lint(std, '- [ ] t', 'full').length > 0);
});

test('comentarios HTML: se corta lo que sigue a <!-- en una ruta de Alcance (con o sin espacio) y los anidados no dejan uno nuevo en la linea ADR', () => {
  assert.equal(sinComentarioHtml('02-DOCS/wiki/project/** <!-- nota -->'), '02-DOCS/wiki/project/**');
  assert.equal(sinComentarioHtml('02-DOCS/wiki/project/**<!-- nota -->'), '02-DOCS/wiki/project/**', 'pegado a la ruta tambien');
  assert.equal(sinComentarioHtml('a/b <!-- sin cerrar'), 'a/b'); assert.equal(sinComentarioHtml('a/b'), 'a/b');
  assert.deepEqual(probs(sub('- 02-DOCS/wiki/project/**\n', '- 02-DOCS/wiki/project/**<!-- nota -->\n')), [], 'una ruta valida con el comentario pegado no es un error');
  assert.ok(probs(sub('- 02-DOCS/wiki/project/**\n', '- src/** <!-- nota -->\n')).some((p) => /Alcance/.test(p) && p.includes("'src/**'")), 'el comentario no esconde una ruta fuera de la base');
  const dec = (suf) => sub('ADR: none', 'ADR: Cancelacion por eventos', sub('- 02-DOCS/wiki/project/**\n', `- 02-DOCS/wiki/project/**\n- 02-DOCS/wiki/sdd/decisions.md${suf}\n`)).replace('| ENT-1 | 03-dominio | domain-modeler |', '| ENT-1 | 03-dominio | domain-modeler |\n| nuevo | decisions | architect |');
  const T = TASKS + '- [ ] T4 (decisions, architect): registrar el ADR\n';
  assert.deepEqual(probs(dec(''), T), [], 'base: decisions.md con ADR y fila');
  assert.deepEqual(probs(dec('<!-- nota -->'), T), [], 'decisions.md con el comentario pegado sigue siendo decisions.md');
  assert.deepEqual(probs(dec(' <!-- nota -->'), T), []);
  assert.equal(adr('ADR: none <!-- ninguno -->'), 'none'); assert.equal(adr('ADR: <!-- a --><!-- b -->'), 'none');
  assert.equal(adr('ADR: <!<!-- a -->-- b -->'), 'none', 'el comentario que aparece al quitar otro tambien se quita');
  assert.equal(adr('ADR: Usar clamp <!-- sin cerrar'), 'Usar clamp <!-- sin cerrar', 'un comentario sin cerrar se queda: el valor no es none (falla cerrado)');
});
