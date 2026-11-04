#!/usr/bin/env node
/**
 * probe-permissions.mjs — comprueba la politica EFECTIVA de permisos, la que OpenCode realmente aplicara,
 * no la que crees haber escrito. Evalua una bateria de comandos contra permission.bash y permission.read
 * con la regla de OpenCode: gana la ULTIMA regla que calza (sin regla => "ask").
 *
 * Uso:   opencode debug config | node factory/scripts/probe-permissions.mjs
 *        node factory/scripts/probe-permissions.mjs --file config.json
 * Salida: 0 = toda la bateria cumple · 1 = alguna sonda falla · 3 = no se pudo leer la configuracion o falta permission.bash/read
 * Nota: por una tuberia, `opencode debug config` llega truncado a 64 KiB; el permission raiz va al principio y se lee igual.
 *
 * Por que importa: el orden de las claves tras fusionar la config managed con la del proyecto puede dejar un
 * deny generico (`git push *`) DESPUES del allow de factory/*, y entonces el push legitimo queda denegado
 * (o, al reves, un deny desaparece). Solo se ve en la salida real de `opencode debug config`.
 * Nota: "ask" cuenta como fallo en las sondas deny, porque `opencode run --auto` aprueba lo que no esta denegado.
 * Limite: evalua los permisos GLOBALES; los permisos propios de cada agente (frontmatter) los cubren los tests.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Devuelve el fin (exclusivo) del valor JSON que empieza en `start` ({ o [), o -1 si no cierra. Respeta strings y escapes. */
function matchEnd(t, start) {
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Extrae `{ permission }` de nivel RAIZ de la salida de `opencode debug config`. No exige que el documento sea
 * JSON valido: por una tuberia la salida llega truncada a 64 KiB, pero el permission raiz va al principio.
 * Un `permission` anidado (agent.*, provider...) nunca cuenta.
 */
export function extractJson(text) {
  const clean = String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  try { const v = JSON.parse(clean); if (v && typeof v === 'object' && v.permission) return v; } catch { /* truncado o con texto alrededor */ }
  const root = clean.indexOf('{');
  if (root < 0) return null;
  const whole = matchEnd(clean, root);
  if (whole > 0) { try { const v = JSON.parse(clean.slice(root, whole)); if (v && typeof v === 'object' && v.permission) return v; } catch { /* sigue */ } }
  // Recorre las claves del objeto raiz (profundidad 1), saltando cada valor completo.
  let i = root + 1;
  while (i < clean.length) {
    const c = clean[i];
    if (c === '"') {
      const keyEnd = matchString(clean, i);
      if (keyEnd < 0) return null;
      const key = clean.slice(i + 1, keyEnd - 1);
      let j = keyEnd; while (/\s/.test(clean[j] || '')) j++;
      if (clean[j] !== ':') { i = keyEnd; continue; }
      j++; while (/\s/.test(clean[j] || '')) j++;
      if (clean[j] === '{' || clean[j] === '[') {
        const end = matchEnd(clean, j);
        if (end < 0) return null;
        if (key === 'permission') { try { return { permission: JSON.parse(clean.slice(j, end)) }; } catch { return null; } }
        i = end;
      } else if (clean[j] === '"') {
        const end = matchString(clean, j);
        if (end < 0) return null;
        i = end;
      } else i = j;
    } else if (c === '}') return null;
    else i++;
  }
  return null;
}

/** Fin (exclusivo) del string que empieza en `start` (una comilla), o -1 si no cierra. */
function matchString(t, start) {
  for (let i = start + 1, esc = false; i < t.length; i++) {
    if (esc) esc = false; else if (t[i] === '\\') esc = true; else if (t[i] === '"') return i + 1;
  }
  return -1;
}

const rx = (pat) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 's');
/**
 * rules: objeto {patron: accion} en orden, lista [{permission, pattern, action}] (se filtra por `tool`) o accion simple.
 * Gana la ultima que calza; sin regla => "ask".
 */
export function decide(rules, value, tool) {
  if (typeof rules === 'string') return rules;
  if (!rules || typeof rules !== 'object') return 'ask';
  let res = 'ask';
  if (Array.isArray(rules)) {
    for (const r of rules) {
      if (!r || (tool && r.permission !== undefined && !rx(String(r.permission)).test(tool))) continue;
      if (rx(String(r.pattern ?? '*')).test(value)) res = r.action;
    }
    return res;
  }
  for (const [pat, act] of Object.entries(rules)) if (rx(pat).test(value)) res = act;
  return res;
}

export const PROBES = [
  // push: UNICA via permitida
  ['bash', 'git push -u origin factory/job-1', 'allow'],
  ['bash', 'git push', 'deny'],
  ['bash', 'git push origin main', 'deny'],
  ['bash', 'git push -u origin main', 'deny'],
  ['bash', 'git push origin HEAD:main', 'deny'],
  ['bash', 'git push -u origin factory/job-1:main', 'deny'],
  ['bash', 'git push -u origin factory/job-1 main', 'deny'],
  ['bash', 'git push -u origin factory/job-1 --force', 'deny'],
  ['bash', 'git push --force origin factory/job-1', 'deny'],
  ['bash', 'git push -u origin factory/job-1 --delete', 'deny'],
  ['bash', 'git push -u origin factory/job-1 +main', 'deny'],
  ['bash', 'git push --all origin', 'deny'],
  ['bash', 'git push --tags origin', 'deny'],
  // integracion y destruccion
  ['bash', 'git merge factory/job-1', 'deny'],
  ['bash', 'git reset --hard HEAD~1', 'deny'],
  ['bash', 'git clean -fd', 'deny'],
  ['bash', 'gh pr merge 1 --squash', 'deny'],
  ['bash', 'gh pr ready 1', 'deny'],
  ['bash', 'gh pr review 1 --approve', 'deny'],
  ['bash', 'gh api -X DELETE repos/o/r', 'deny'],
  ['bash', 'gh auth token', 'deny'],
  ['bash', 'gh secret list', 'deny'],
  ['bash', 'gh repo delete o/r --yes', 'deny'],
  ['bash', 'rm -rf /', 'deny'],
  ['bash', 'rm -fr node_modules', 'deny'],
  ['bash', 'printenv', 'deny'],
  // PR borrador: permitido
  ['bash', 'gh pr create --draft --title t --body b', 'allow'],
  // secretos
  ['read', '.env', 'deny'],
  ['read', 'config/.env.production', 'deny'],
  ['read', '.env.example', 'allow'],
  ['read', 'src/app.js', 'allow'],
];

export function runProbes(config, probes = PROBES) {
  const perm = config?.permission || {};
  return probes.map(([tool, value, expect]) => {
    const got = decide(Array.isArray(perm) ? perm : perm[tool], value, tool);
    return { tool, value, expect, got, ok: got === expect };
  });
}

const ACTIONS = new Set(['allow', 'deny', 'ask']);
/**
 * `opencode debug config` enmascara como "***" el valor de las reglas cuya clave contiene "secret". Esa accion no se
 * puede evaluar desde la salida: se resuelve con las fuentes declaradas (managed gana sobre el proyecto) y, si ninguna
 * la declara, se deja "***" (la sonda falla). Devuelve las resoluciones hechas, para decirlas en voz alta.
 */
export function unmask(perm, sources) {
  const done = [];
  if (!perm || typeof perm !== 'object' || Array.isArray(perm)) return done;
  for (const [tool, rules] of Object.entries(perm)) {
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) continue;
    for (const [pat, act] of Object.entries(rules)) {
      if (ACTIONS.has(act)) continue;
      const known = sources.map((src) => src?.permission?.[tool]?.[pat]).filter((a) => ACTIONS.has(a)).pop();
      if (known) { rules[pat] = known; done.push(`${tool} "${pat}": ${act} -> ${known}`); }
    }
  }
  return done;
}

function hasRules(perm, tool) {
  const r = Array.isArray(perm) ? perm.filter((x) => x?.permission === tool) : perm?.[tool];
  if (typeof r === 'string') return true;
  return Array.isArray(r) ? r.length > 0 : !!r && typeof r === 'object' && Object.keys(r).length > 0;
}

function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--file');
  const text = fi >= 0 ? fs.readFileSync(args[fi + 1], 'utf8') : fs.readFileSync(0, 'utf8');
  const cfg = extractJson(text);
  if (!cfg) { console.error('No pude leer la configuracion (esperaba la salida JSON de `opencode debug config`).'); process.exit(3); }
  const readJson = (rel) => { try { return JSON.parse(fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')); } catch { return null; } };
  for (const m of unmask(cfg.permission, [readJson('../../opencode.json'), readJson('../templates/managed-opencode.json')])) {
    console.log(`AVISO valor enmascarado por opencode, resuelto desde las fuentes: ${m}`);
  }
  for (const tool of ['bash', 'read']) {
    if (!hasRules(cfg.permission, tool)) {
      console.error(`La configuracion leida no trae permission.${tool} (o esta vacio): no evaluo la politica.` +
        (text.length >= 65536 ? ' La salida mide 64 KiB: puede venir truncada; usa `opencode debug config > cfg.txt` y `--file cfg.txt`.' : ''));
      process.exit(3);
    }
  }
  const results = runProbes(cfg);
  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.tool.padEnd(4)} ${r.value}  -> ${r.got}${r.ok ? '' : ` (esperado ${r.expect})`}`);
  const bad = results.filter((r) => !r.ok);
  console.log(bad.length ? `\n${bad.length} sonda(s) FALLAN: la politica efectiva no es la que crees.` : `\nPolitica efectiva correcta (${results.length} sondas).`);
  process.exit(bad.length ? 1 : 0);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
