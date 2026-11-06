// Fixture de project-lint: un proyecto temporal minimo y valido (pasa `check --strict`), que cada test deforma un poco.
import path from 'node:path';
import { REPO, tmp, write, run } from './helpers.mjs';

export const LINT = path.join(REPO, 'factory/scripts/project-lint.mjs');
export const DOC_NAMES = ['00-vision', '01-requisitos', '02-casos-de-uso', '03-dominio', '04-arquitectura', '05-datos', '06-despliegue'];

export const head = (doc, { estado = 'borrador', version = '0.1.0', fecha = '2026-11-06', responsable = 'system-analyst' } = {}) =>
  `---\ndocumento: ${doc}\nestado: ${estado}\nversion: ${version}\nfecha: ${fecha}\nresponsable: ${responsable}\n---\n\n`;

export const BODY = {
  '00-vision': `# Visión

## Propósito
Gestionar pedidos para el [[Cliente]]. [FUENTE: README.md#Alcance]
`,
  '01-requisitos': `# Requisitos

## Requisitos funcionales
- REQ-F-1: el sistema debe permitir al [[Cliente]] crear un [[Pedido]]. [FUENTE: README.md#Alcance]
- REQ-F-2: el sistema debe listar los pedidos. [FUENTE: discovery.md#Q-1]

## Requisitos no funcionales
- REQ-NF-1: el listado responde rápido. Métrica: p95 < 300 ms [FUENTE: discovery.md#Q-2]
`,
  '02-casos-de-uso': `# Casos de uso

## Casos de uso
### UC-1: Crear pedido
- Actor: [[Cliente]]
- Cubre: REQ-F-1
- Usa: ENT-1, ENT-2
- Flujo:
  1. El cliente envía el pedido.
[FUENTE: README.md#Alcance]

### UC-2: Listar pedidos
- Actor: [[Cliente]]
- Cubre: REQ-F-2
- Usa: ENT-1
[FUENTE: discovery.md#Q-1]
`,
  '03-dominio': `# Dominio

## Entidades
### ENT-1: Pedido
- Atributos: número, fecha
- Relaciones: ENT-2 (muchos a uno)
[FUENTE: README.md#Alcance]

### ENT-2: Cliente
- Atributos: nombre
[FUENTE: README.md#Alcance]

## Glosario
- **Despacho**: salida del pedido hacia el cliente (alias: envío)
`,
  '04-arquitectura': `# Arquitectura

## Cumplimiento de requisitos no funcionales
REQ-NF-1 se cumple con un índice sobre ENT-1 (ADR-001).
`,
  '05-datos': `# Datos

## Modelo de datos
ENT-1 se guarda en la tabla pedidos y ENT-2 en la tabla clientes.
`,
  '06-despliegue': `# Despliegue

## Operación y observabilidad
REQ-NF-1 se vigila con una alerta de latencia p95.
`,
};
const OWNER = { '00-vision': 'system-analyst', '01-requisitos': 'system-analyst', '02-casos-de-uso': 'system-analyst', '03-dominio': 'domain-modeler', '04-arquitectura': 'architect', '05-datos': 'domain-modeler', '06-despliegue': 'deployment-planner' };

export const DISCOVERY = `${head('discovery', { responsable: 'discovery' })}# Descubrimiento

## Preguntas
### Ronda 1
- Q-1 [RESUELTO]: ¿se listan los pedidos?
- Q-2 [RESUELTO]: ¿cuánto puede tardar el listado?
`;

/**
 * Crea el proyecto. `edit[doc]` recibe el texto completo (cabecera incluida) y devuelve el nuevo.
 * `raw[doc]` sustituye el archivo entero. `extra` = { 'ruta': 'texto' } en la raiz.
 */
export function makeProject({ edit = {}, raw = {}, extra = {}, header = {}, skip = [] } = {}) {
  const root = tmp('af-proj-');
  const dir = path.join(root, '02-DOCS/wiki/project');
  write(path.join(root, 'README.md'), '# Demo\n\n## Alcance\nPedidos.\n');
  write(path.join(root, '02-DOCS/wiki/sdd/decisions.md'), '# Decisiones\n\n## ADR-001: Indice\n');
  write(path.join(dir, 'discovery.md'), DISCOVERY);
  for (const d of DOC_NAMES) {
    if (skip.includes(d)) continue;
    const text = head(d, { responsable: OWNER[d], ...(header[d] || {}) }) + BODY[d];
    write(path.join(dir, `${d}.md`), raw[d] ?? (edit[d] ? edit[d](text) : text));
  }
  for (const [f, t] of Object.entries(extra)) write(path.join(root, f), t);
  return { root, dir, file: (d) => path.join(dir, `${d}.md`) };
}

/** Ejecuta el CLI de project-lint dentro del proyecto. */
export const lintCli = (root, ...args) => run('node', [LINT, ...args, '--root', root], { encoding: 'utf8' });
export const codes = (r) => r.stdout.split('\n').filter(Boolean).map((l) => l.split(' ')[0]);
