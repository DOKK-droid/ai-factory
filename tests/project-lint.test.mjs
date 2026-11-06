// project-lint.mjs: formato, IDs, referencias, origen, glosario, cobertura, aprobacion por hash y trazabilidad derivada.
// Cada regla PLxxx tiene un caso que la provoca y la fixture valida demuestra que no salta de mas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write, run, git } from './helpers.mjs';
import { makeProject, lintCli, codes, head, DOC_NAMES, LINT } from './project-fixture.mjs';

const check = (p, ...a) => lintCli(p.root, 'check', '--strict', ...a);
const has = (r, code, re) => assert.ok(r.stdout.split('\n').some((l) => l.startsWith(code + ' ') && (!re || re.test(l))), `esperaba ${code}${re ? ' /' + re + '/' : ''} en:\n${r.stdout}`);
const hasNot = (r, code) => assert.ok(!codes(r).includes(code), `no esperaba ${code} en:\n${r.stdout}`);
const sub = (from, to) => (t) => { assert.ok(t.includes(from), `la fixture ya no contiene: ${from}`); return t.replace(from, to); };
const approveAll = (p) => lintCli(p.root, 'approve', ...DOC_NAMES);
const readReg = (p) => JSON.parse(fs.readFileSync(path.join(p.dir, 'project.ok'), 'utf8'));

// ---------------------------------------------------------------- plantillas y fixture
test('RF-I1: las 8 plantillas existen, pasan check como plantilla y no se pueden aprobar', () => {
  const root = tmp('af-tpl-'); const dir = path.join(root, '02-DOCS/wiki/project');
  const tpl = path.join(REPO, 'factory/templates/project');
  for (const f of [...DOC_NAMES, 'discovery']) { assert.ok(fs.existsSync(path.join(tpl, `${f}.md`)), `falta la plantilla ${f}`); write(path.join(dir, `${f}.md`), fs.readFileSync(path.join(tpl, `${f}.md`), 'utf8')); }
  const r = lintCli(root, 'check'); assert.equal(r.status, 0, r.stdout); assert.equal(r.stdout.trim(), '');
  assert.match(lintCli(root, 'state').stdout, /PROJECT=none/);
  const g = lintCli(root, 'gate'); assert.equal(g.status, 1); assert.match(g.stdout, /GATE 00-vision: PLANTILLA/);
  const a = lintCli(root, 'approve', '00-vision'); assert.equal(a.status, 1); assert.match(a.stdout, /RELLENAR|plantilla/i);
  for (const f of DOC_NAMES) assert.match(fs.readFileSync(path.join(tpl, `${f}.md`), 'utf8'), /^---\ndocumento: [\w-]+\nestado: borrador\nversion: \d+\.\d+\.\d+\nfecha: \d{4}-\d{2}-\d{2}\nresponsable: [\w-]+\n---\n/, `cabecera de ${f}`);
});
test('la fixture valida pasa check --strict y gate la rechaza mientras no esté aprobada', () => {
  const p = makeProject(); const r = check(p); assert.equal(r.status, 0, r.stdout); assert.equal(r.stdout.trim(), '');
  const g = lintCli(p.root, 'gate'); assert.equal(g.status, 1); assert.match(g.stdout, /GATE 01-requisitos: LISTO/);
});

// ---------------------------------------------------------------- cabecera
test('PL001-PL004: cabecera completa, estado, version/fecha y nombre del documento', () => {
  has(check(makeProject({ raw: { '00-vision': '# Visión\n' } })), 'PL001', /sin cabecera/);
  has(check(makeProject({ edit: { '00-vision': sub('responsable: system-analyst\n', '') } })), 'PL001', /responsable/);
  has(check(makeProject({ header: { '00-vision': { estado: 'listo' } } })), 'PL002');
  has(check(makeProject({ header: { '00-vision': { version: '1.0' } } })), 'PL003', /semver/);
  has(check(makeProject({ header: { '00-vision': { fecha: '06/11/2026' } } })), 'PL003', /AAAA-MM-DD/);
  has(check(makeProject({ edit: { '00-vision': sub('documento: 00-vision', 'documento: otra') } })), 'PL004');
  has(check(makeProject({ skip: ['05-datos'] })), 'PL005', /05-datos/);
  hasNot(lintCli(makeProject({ skip: ['05-datos'] }).root, 'check'), 'PL005');   // sin --strict, un documento ausente no es error
});

// ---------------------------------------------------------------- IDs
test('PL010: ID mal formado; REQ-F y REQ-NF sin numero son nombres de tipo y se aceptan', () => {
  has(check(makeProject({ edit: { '05-datos': (t) => t + 'Ver REQ-F-x y UC-1a.\n' } })), 'PL010', /REQ-F-x/);
  has(check(makeProject({ edit: { '05-datos': (t) => t + 'Ver ENT-uno.\n' } })), 'PL010', /ENT-uno/);
  hasNot(check(makeProject({ edit: { '05-datos': (t) => t + 'Los REQ-F y los REQ-NF viven en 01.\n' } })), 'PL010');
});
test('PL011: ID definido dos veces, en el mismo documento o en otro', () => {
  has(check(makeProject({ edit: { '01-requisitos': (t) => t + '- REQ-F-1: repetido. [FUENTE: README.md#Alcance]\n' } })), 'PL011', /REQ-F-1/);
  has(check(makeProject({ edit: { '03-dominio': (t) => t.replace('### ENT-2: Cliente', '### ENT-1: Cliente') } })), 'PL011', /ENT-1/);
});
test('PL012: un ID se define solo en su documento; citarlo en prosa en otro es lo correcto', () => {
  has(check(makeProject({ edit: { '04-arquitectura': (t) => t + '- REQ-F-9: otro requisito. [FUENTE: README.md#Alcance]\n' } })), 'PL012', /01-requisitos/);
  has(check(makeProject({ edit: { '05-datos': (t) => t + '### UC-9: caso suelto\n- Cubre: REQ-F-1\n[FUENTE: README.md#Alcance]\n' } })), 'PL012', /02-casos-de-uso/);
  assert.equal(check(makeProject()).status, 0);
});
test('PL013: RF-n y RF-F de specs y de la fábrica no aparecen en documentos de proyecto', () => {
  has(check(makeProject({ edit: { '04-arquitectura': (t) => t + 'Cumple RF-3.\n' } })), 'PL013', /RF-3/);
  has(check(makeProject({ edit: { '04-arquitectura': (t) => t + 'Cumple RF-F2.\n' } })), 'PL013', /RF-F2/);
});
test('PL020: referencias a IDs y ADR que no existen', () => {
  has(check(makeProject({ edit: { '06-despliegue': (t) => t + 'Cubre REQ-NF-9.\n' } })), 'PL020', /REQ-NF-9/);
  has(check(makeProject({ edit: { '04-arquitectura': sub('ADR-001', 'ADR-099') } })), 'PL020', /ADR-099/);
  has(check(makeProject({ edit: { '02-casos-de-uso': sub('Cubre: REQ-F-1', 'Cubre: REQ-F-1, REQ-F-7') } })), 'PL020', /REQ-F-7/);
});

// ---------------------------------------------------------------- cobertura
test('PL021: REQ-F que ningún UC cubre', () => {
  has(check(makeProject({ edit: { '02-casos-de-uso': sub('Cubre: REQ-F-2', 'Cubre: REQ-F-1') } })), 'PL021', /REQ-F-2/);
});
test('PL022: UC sin Cubre o sin ningún REQ-F', () => {
  has(check(makeProject({ edit: { '02-casos-de-uso': sub('- Cubre: REQ-F-2\n', '') } })), 'PL022', /UC-2/);
  has(check(makeProject({ edit: { '02-casos-de-uso': sub('Cubre: REQ-F-2', 'Cubre: REQ-NF-1') } })), 'PL022', /UC-2/);
});
test('PL023: ENT que ningún requisito ni caso de uso usa', () => {
  has(check(makeProject({ edit: { '02-casos-de-uso': sub('Usa: ENT-1, ENT-2', 'Usa: ENT-1') } })), 'PL023', /ENT-2/);
});
test('PL024: REQ-NF necesita una métrica con número', () => {
  has(check(makeProject({ edit: { '01-requisitos': sub('Métrica: p95 < 300 ms', 'Métrica: rápido') } })), 'PL024', /REQ-NF-1/);
  has(check(makeProject({ edit: { '01-requisitos': sub(' Métrica: p95 < 300 ms', '') } })), 'PL024');
});
test('PL025: REQ-NF que ni arquitectura ni despliegue citan', () => {
  has(check(makeProject({ raw: { '04-arquitectura': head('04-arquitectura', { responsable: 'architect' }) + '# Arquitectura\nSolo ENT-1.\n', '06-despliegue': head('06-despliegue', { responsable: 'deployment-planner' }) + '# Despliegue\nNada.\n' } })), 'PL025', /REQ-NF-1/);
});
test('PL026: ENT sin entrada en 05-datos', () => {
  has(check(makeProject({ edit: { '05-datos': sub(' y ENT-2 en la tabla clientes', '') } })), 'PL026', /ENT-2/);
});
test('la cobertura entre documentos solo se exige cuando ambos tienen contenido (sin --strict)', () => {
  const tpl = fs.readFileSync(path.join(REPO, 'factory/templates/project/02-casos-de-uso.md'), 'utf8');
  const p = makeProject({ raw: { '02-casos-de-uso': tpl } });
  const r = lintCli(p.root, 'check'); hasNot(r, 'PL021'); has(check(p), 'PL021');
});

// ---------------------------------------------------------------- origen
test('PL030: bloque con ID sin etiqueta de origen', () => {
  has(check(makeProject({ edit: { '01-requisitos': sub(' [FUENTE: discovery.md#Q-1]', '') } })), 'PL030', /REQ-F-2/);
  has(check(makeProject({ edit: { '03-dominio': sub('[FUENTE: README.md#Alcance]\n\n### ENT-2', '\n### ENT-2') } })), 'PL030', /ENT-1/);
});
test('PL031: [FUENTE] debe apuntar a una ruta y un ancla que existan, dentro del repo', () => {
  has(check(makeProject({ edit: { '01-requisitos': sub('README.md#Alcance', 'NOEXISTE.md#Alcance') } })), 'PL031', /no existe NOEXISTE/);
  has(check(makeProject({ edit: { '01-requisitos': sub('README.md#Alcance', 'README.md#Inventado') } })), 'PL031', /ancla/);
  has(check(makeProject({ edit: { '01-requisitos': sub('README.md#Alcance', '/etc/passwd') } })), 'PL031', /relativa/);
  has(check(makeProject({ edit: { '01-requisitos': sub('README.md#Alcance', '../fuera.md') } })), 'PL031');
  has(check(makeProject({ edit: { '01-requisitos': sub('[FUENTE: README.md#Alcance]', '[FUENTE]') } })), 'PL031', /sin ruta/);
  has(check(makeProject({ edit: { '01-requisitos': sub('README.md#Alcance', 'README.md#L99') } })), 'PL031', /linea/);
  hasNot(check(makeProject({ edit: { '01-requisitos': sub('README.md#Alcance', 'README.md#L3') } })), 'PL031');
});
test('PL031: una ruta que sale del repo por enlace simbólico se rechaza', () => {
  const out = tmp('af-out-'); write(path.join(out, 'secreto.md'), '# s\n');
  const p = makeProject();
  fs.symlinkSync(path.join(out, 'secreto.md'), path.join(p.root, 'enlace.md'));
  fs.writeFileSync(p.file('01-requisitos'), fs.readFileSync(p.file('01-requisitos'), 'utf8').replace('README.md#Alcance', 'enlace.md'));
  has(check(p), 'PL031', /sale del repositorio/);
});
test('PL032: [INVESTIGADO] exige URL https y fecha', () => {
  const t = (v) => makeProject({ edit: { '01-requisitos': sub('- REQ-F-2: el sistema debe listar los pedidos. [FUENTE: discovery.md#Q-1]', `- REQ-F-2: el sistema debe listar los pedidos. [FUENTE: discovery.md#Q-1] [INVESTIGADO: ${v}]`) } });
  has(check(t('http://x.com, 2026-11-06')), 'PL032'); has(check(t('https://x.com')), 'PL032'); hasNot(check(t('https://x.com/doc, 2026-11-06')), 'PL032');
});
test('PL033 y PL034: en un documento aprobado no hay PENDIENTE/PROPUESTO/INFERIDO y todo bloque lleva FUENTE', () => {
  for (const kind of ['PENDIENTE', 'PROPUESTO', 'INFERIDO']) {
    const p = makeProject({ edit: { '00-vision': sub('[FUENTE: README.md#Alcance]', `[FUENTE: README.md#Alcance] [${kind}]`) } });
    assert.equal(lintCli(p.root, 'approve', '00-vision').status, 1, kind); has(lintCli(p.root, 'approve', '00-vision'), 'PL033');
    hasNot(check(p), 'PL033');   // mientras es borrador sí se permite
  }
  const q = makeProject({ edit: { '01-requisitos': sub('[FUENTE: discovery.md#Q-1]', '[INFERIDO]') } });
  has(lintCli(q.root, 'approve', '01-requisitos'), 'PL034', /REQ-F-2/); hasNot(check(q), 'PL034');
});
test('PL070: no se aprueba un documento con marcadores RELLENAR', () => {
  const p = makeProject({ edit: { '00-vision': (t) => t + '<!-- RELLENAR: pendiente -->\n' } });
  const r = lintCli(p.root, 'approve', '00-vision'); assert.equal(r.status, 1); has(r, 'PL070');
});

// ---------------------------------------------------------------- glosario
test('PL040: términos entre doble corchete fuera del glosario; las entidades y los alias cuentan', () => {
  has(check(makeProject({ edit: { '00-vision': sub('[[Cliente]]', '[[Comprador]]') } })), 'PL040', /Comprador/);
  hasNot(check(makeProject({ edit: { '00-vision': sub('[[Cliente]]', '[[envío]]') } })), 'PL040');   // alias del glosario
  hasNot(check(makeProject({ edit: { '00-vision': sub('[[Cliente]]', '[[cliente]]') } })), 'PL040'); // sin distinguir mayúsculas
});
test('PL041: término repetido en el glosario (incluidos alias y nombres de entidad)', () => {
  has(check(makeProject({ edit: { '03-dominio': sub('(alias: envío)', '(alias: Pedido)') } })), 'PL041', /Pedido/);
  has(check(makeProject({ edit: { '03-dominio': (t) => t + '- **Despacho**: otra vez\n' } })), 'PL041', /Despacho/);
});
test('el contenido de bloques de código, comentarios HTML y código en línea no cuenta', () => {
  const noise = '\n```mermaid\nflowchart LR\n  A[REQ-F-99 UC-x RF-5 [[Nada]]] --> B\n```\n<!-- REQ-F-98 [[Otra]] [PENDIENTE] -->\nCódigo `REQ-F-97` en línea.\n';
  assert.equal(check(makeProject({ edit: { '04-arquitectura': (t) => t + noise } })).status, 0);
});

// ---------------------------------------------------------------- aprobación y frescura (hash)
test('approve: registra hash, marca aprobado en la cabecera y gate pasa; no depende de mtime', () => {
  const p = makeProject(); const a = approveAll(p); assert.equal(a.status, 0, a.stdout);
  const reg = readReg(p); assert.deepEqual(Object.keys(reg.docs), DOC_NAMES);
  assert.match(reg.docs['01-requisitos'].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(reg.docs['02-casos-de-uso'].refs), ['ENT-1', 'ENT-2', 'REQ-F-1', 'REQ-F-2']);
  assert.match(fs.readFileSync(p.file('01-requisitos'), 'utf8'), /^estado: aprobado$/m);
  const g = lintCli(p.root, 'gate'); assert.equal(g.status, 0, g.stdout); assert.match(lintCli(p.root, 'state').stdout, /PROJECT=complete/);
  // reordenar mtimes (lo que hace un clon) no cambia nada
  const old = new Date(2000, 0, 1); for (const d of DOC_NAMES) fs.utimesSync(p.file(d), old, old);
  fs.utimesSync(path.join(p.dir, 'project.ok'), old, old);
  assert.equal(lintCli(p.root, 'gate').status, 0);
  // y la cabecera no entra en el hash: cambiar la fecha no desactualiza
  fs.writeFileSync(p.file('00-vision'), fs.readFileSync(p.file('00-vision'), 'utf8').replace('fecha: 2026-11-06', 'fecha: 2027-01-01'));
  assert.equal(lintCli(p.root, 'gate').status, 0);
});
test('PL050: editar un documento aprobado lo desactualiza, y gate falla', () => {
  const p = makeProject(); approveAll(p);
  fs.appendFileSync(p.file('00-vision'), '\nOtra frase. [FUENTE: README.md#Alcance]\n');
  const r = check(p); has(r, 'PL050', /00-vision/); assert.equal(r.status, 1);
  assert.equal(lintCli(p.root, 'gate').status, 1);
  assert.match(lintCli(p.root, 'state').stdout, /DOC 00-vision DESACTUALIZADO/);
});
test('PL052: si el contenido cambia y la versión no, avisa (W) sin romper', () => {
  const p = makeProject(); approveAll(p);
  fs.appendFileSync(p.file('00-vision'), '\nOtra frase. [FUENTE: README.md#Alcance]\n');
  fs.writeFileSync(p.file('00-vision'), fs.readFileSync(p.file('00-vision'), 'utf8').replace('estado: aprobado', 'estado: desactualizado'));
  const r = check(p); assert.ok(r.stdout.split('\n').some((l) => /^PL052 W /.test(l)), r.stdout); hasNot(r, 'PL050');
  fs.writeFileSync(p.file('00-vision'), fs.readFileSync(p.file('00-vision'), 'utf8').replace('version: 0.1.0', 'version: 0.2.0'));
  hasNot(check(p), 'PL052');
});
test('PL051: si cambia un ID que otro documento aprobado cita, solo ese se marca; impact --changed lo dice', () => {
  const p = makeProject(); approveAll(p);
  // cambia REQ-F-2 en 01 (y 01 se reabre como corresponde)
  let t = fs.readFileSync(p.file('01-requisitos'), 'utf8').replace('listar los pedidos.', 'listar y filtrar los pedidos.').replace('estado: aprobado', 'estado: desactualizado').replace('version: 0.1.0', 'version: 0.2.0');
  fs.writeFileSync(p.file('01-requisitos'), t);
  const r = check(p);
  has(r, 'PL051', /02-casos-de-uso.*REQ-F-2/);
  assert.ok(!r.stdout.split('\n').some((l) => l.startsWith('PL051') && /(04-arquitectura|05-datos|03-dominio)/.test(l)), r.stdout);
  const st = lintCli(p.root, 'state').stdout;
  assert.match(st, /DOC 02-casos-de-uso DESACTUALIZADO/); assert.match(st, /DOC 05-datos APROBADO/); assert.match(st, /REOPEN=01-requisitos:system-analyst/); assert.match(st, /REOPEN=02-casos-de-uso:system-analyst \(cita REQ-F-2/);
  const im = lintCli(p.root, 'impact', '--changed').stdout; assert.match(im, /REABRIR system-analyst 02-casos-de-uso \(cita REQ-F-2/); assert.doesNotMatch(im, /05-datos/);
  assert.match(lintCli(p.root, 'state').stdout, /PROJECT=stale/);
});
test('PL051: si desaparece un ID citado, también se detecta', () => {
  const p = makeProject(); approveAll(p);
  fs.writeFileSync(p.file('01-requisitos'), fs.readFileSync(p.file('01-requisitos'), 'utf8').replace(/- REQ-F-2:.*\n/, '').replace('estado: aprobado', 'estado: desactualizado'));
  has(check(p), 'PL051', /ya no existe/);
});
test('PL053: la cabecera no puede decir aprobado sin registro (ni el registro contradecir la cabecera)', () => {
  const p = makeProject({ header: { '00-vision': { estado: 'aprobado' } } });
  has(check(p), 'PL053', /project\.ok/); assert.equal(lintCli(p.root, 'gate').status, 1);
  const q = makeProject(); approveAll(q);
  fs.writeFileSync(q.file('00-vision'), fs.readFileSync(q.file('00-vision'), 'utf8').replace('estado: aprobado', 'estado: borrador'));
  has(check(q), 'PL053', /borrador/); assert.equal(lintCli(q.root, 'gate').status, 1);
});
test('PL054: un project.ok ilegible es un error, nunca una aprobación', () => {
  const p = makeProject(); approveAll(p); fs.writeFileSync(path.join(p.dir, 'project.ok'), '{ no es json');
  has(check(p), 'PL054'); assert.equal(lintCli(p.root, 'gate').status, 1);
});
test('approve exige que las dependencias estén aprobadas o se aprueben a la vez, y solo documentos conocidos', () => {
  const p = makeProject();
  const r = lintCli(p.root, 'approve', '02-casos-de-uso'); assert.equal(r.status, 1); assert.match(r.stdout, /01-requisitos, que no está aprobado|03-dominio, que no está aprobado/);
  assert.equal(lintCli(p.root, 'approve', '01-requisitos', '03-dominio', '02-casos-de-uso').status, 0);
  assert.equal(lintCli(p.root, 'approve', 'discovery').status, 1); assert.equal(lintCli(p.root, 'approve', 'trazabilidad').status, 1);
  assert.equal(lintCli(p.root, 'approve').status, 64);
});
test('approve se niega con errores del documento y no escribe nada', () => {
  const p = makeProject({ edit: { '01-requisitos': sub('Métrica: p95 < 300 ms', 'Métrica: rápido') } });
  const r = lintCli(p.root, 'approve', '01-requisitos'); assert.equal(r.status, 1); assert.match(r.stdout, /PL024/);
  assert.ok(!fs.existsSync(path.join(p.dir, 'project.ok'))); assert.match(fs.readFileSync(p.file('01-requisitos'), 'utf8'), /estado: borrador/);
});

// ---------------------------------------------------------------- state / impact / trace
test('state: estado por documento derivado de los archivos, siguiente documento y pendientes', () => {
  const p = makeProject({ edit: { '01-requisitos': sub('[FUENTE: discovery.md#Q-1]', '[PENDIENTE]') } });
  const st = lintCli(p.root, 'state').stdout;
  assert.match(st, /DOC 01-requisitos PENDIENTE/); assert.match(st, /DOC 00-vision LISTO/); assert.match(st, /PENDIENTES=1/); assert.match(st, /PROJECT=partial/); assert.match(st, /NEXT=00-vision OWNER=system-analyst/);
  assert.match(lintCli(makeProject({ edit: { '01-requisitos': sub('Métrica: p95 < 300 ms', 'Métrica: rápido') } }).root, 'state').stdout, /DOC 01-requisitos BORRADOR/);
  const empty = lintCli(tmp('af-empty-'), 'state').stdout; assert.match(empty, /PROJECT=none/); assert.match(empty, /DOC 00-vision AUSENTE/);
});
test('state: PROJECT=complete exige 7 aprobados y 0 pendientes en discovery', () => {
  const p = makeProject(); approveAll(p);
  fs.appendFileSync(path.join(p.dir, 'discovery.md'), '- Q-3 [PENDIENTE]: ¿algo más?\n');
  const st = lintCli(p.root, 'state').stdout; assert.match(st, /PENDIENTES=1/); assert.match(st, /PROJECT=partial/); assert.equal(lintCli(p.root, 'gate').status, 1);
});
test('impact: por ID y por documento lista quién lo cita y su responsable', () => {
  const p = makeProject();
  const a = lintCli(p.root, 'impact', 'REQ-NF-1').stdout; assert.match(a, /REVISAR 04-arquitectura\.md:\d+ \(architect\)/); assert.match(a, /06-despliegue\.md:\d+ \(deployment-planner\)/);
  const b = lintCli(p.root, 'impact', '03-dominio').stdout; assert.match(b, /REVISAR 02-casos-de-uso \(system-analyst\)/); assert.match(b, /REVISAR 05-datos \(domain-modeler\)/);
  assert.equal(lintCli(p.root, 'impact', 'REQ-F-77').status, 1); assert.equal(lintCli(p.root, 'impact').status, 64);
});
test('trace: determinista, sin depender del orden ni de mtime; --write y PL061', () => {
  const p = makeProject(); const a = lintCli(p.root, 'trace').stdout; assert.equal(a, lintCli(p.root, 'trace').stdout);
  assert.match(a, /\| REQ-F-1 \| UC-1 \|/); assert.match(a, /\| UC-1 \| REQ-F-1 \| ENT-1, ENT-2 \|/); assert.match(a, /\| REQ-NF-1 \| 01-requisitos \| system-analyst \| 04-arquitectura, 06-despliegue \|/); assert.match(a, /generado: true/);
  hasNot(check(p), 'PL061');   // si no existe, no se exige
  assert.equal(lintCli(p.root, 'trace', '--write').status, 0); assert.equal(fs.readFileSync(path.join(p.dir, 'trazabilidad.md'), 'utf8'), a);
  assert.equal(check(p).status, 0);
  fs.appendFileSync(path.join(p.dir, 'trazabilidad.md'), 'editado a mano\n'); has(check(p), 'PL061');
  lintCli(p.root, 'trace', '--write'); fs.appendFileSync(p.file('02-casos-de-uso'), '\n### UC-3: Otro\n- Cubre: REQ-F-1\n[FUENTE: README.md#Alcance]\n'); has(check(p), 'PL061');
  const old = new Date(2001, 0, 1); for (const d of DOC_NAMES) fs.utimesSync(p.file(d), old, old);
  assert.equal(lintCli(makeProject().root, 'trace').stdout, a);
});
test('PL060 (aviso): el texto de un REQ copiado literalmente en otro documento', () => {
  const p = makeProject({ edit: { '04-arquitectura': (t) => t + 'el sistema debe permitir al [[Cliente]] crear un [[Pedido]].\n' } });
  const r = check(p); assert.ok(r.stdout.split('\n').some((l) => /^PL060 W 04-arquitectura/.test(l)), r.stdout); assert.equal(r.status, 0);
});

// ---------------------------------------------------------------- CLI
test('CLI: uso incorrecto sale 64; sin la carpeta, check no falla y gate sí', () => {
  for (const a of [[], ['bogus'], ['check', '--nope']]) assert.equal(lintCli(tmp('af-x-'), ...a).status, 64, a.join(' '));
  assert.equal(run('node', [LINT, 'check', '--dir']).status, 64);
  assert.equal(lintCli(tmp('af-x-'), 'check').status, 0); assert.equal(lintCli(tmp('af-x-'), 'gate').status, 1);
  assert.equal(fs.existsSync(LINT), true);
});

// ---------------------------------------------------------------- instalador
test('RF-I14: el instalador lleva plantillas y scripts al destino sin crear documentos de proyecto ni heredar nada de la fábrica', () => {
  const d = tmp('af-inst-'); git(d, 'init', '-q', '-b', 'main'); git(d, 'config', 'user.email', 't@t.t'); git(d, 'config', 'user.name', 't'); git(d, 'config', 'commit.gpgsign', 'false');
  write(path.join(d, 'README.md'), '# p\n'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base');
  const r = run('bash', [path.join(REPO, 'factory/scripts/install-into.sh'), d, '--apply'], { cwd: REPO });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const f of [...DOC_NAMES, 'discovery']) assert.ok(fs.existsSync(path.join(d, 'factory/templates/project', `${f}.md`)), `plantilla ${f} no instalada`);
  for (const f of ['project-lint.mjs', 'gen-index.mjs']) assert.ok(fs.existsSync(path.join(d, 'factory/scripts', f)), `${f} no instalado`);
  assert.ok(!fs.existsSync(path.join(d, '02-DOCS/wiki/project')), 'el instalador no debe crear la base documental: la crea /factory-init');
  assert.ok(!fs.existsSync(path.join(d, '02-DOCS/wiki/sdd/factory-init-spec.md')), 'las páginas de la fábrica no viajan');
  assert.equal(run('bash', [path.join(REPO, 'factory/scripts/install-into.sh'), d, '--check'], { cwd: REPO }).status, 0);
});
