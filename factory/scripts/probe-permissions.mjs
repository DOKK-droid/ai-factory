#!/usr/bin/env node
/**
 * probe-permissions.mjs — comprueba la politica EFECTIVA de permisos, la que OpenCode realmente aplicara,
 * no la que crees haber escrito. Evalua una bateria de comandos contra permission.bash y permission.read
 * con la regla de OpenCode: gana la ULTIMA regla que calza (sin regla => "ask").
 *
 * Uso:   opencode debug config | node factory/scripts/probe-permissions.mjs
 *        node factory/scripts/probe-permissions.mjs --file config.json
 * Salida: 0 = toda la bateria cumple · 1 = alguna sonda falla · 3 = no se pudo leer la configuracion
 *
 * Por que importa: el orden de las claves tras fusionar la config managed con la del proyecto puede dejar un
 * deny generico (`git push *`) DESPUES del allow de factory/*, y entonces el push legitimo queda denegado
 * (o, al reves, un deny desaparece). Solo se ve en la salida real de `opencode debug config`.
 * Nota: "ask" cuenta como fallo en las sondas deny, porque `opencode run --auto` aprueba lo que no esta denegado.
 * Limite: evalua los permisos GLOBALES; los permisos propios de cada agente (frontmatter) los cubren los tests.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function extractJson(text) {
  const clean = String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  try { return JSON.parse(clean); } catch { /* hay texto alrededor: se busca el objeto */ }
  for (let start = clean.indexOf('{'); start >= 0; start = clean.indexOf('{', start + 1)) {
    let depth = 0; let inStr = false; let esc = false;
    for (let i = start; i < clean.length; i++) {
      const c = clean[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { const v = JSON.parse(clean.slice(start, i + 1)); if (v && typeof v === 'object' && v.permission) return v; } catch { /* siguiente candidato */ }
        break;
      }
    }
  }
  return null;
}

const rx = (pat) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 's');
/** rules: objeto {patron: accion} en orden, o accion simple. Gana la ultima que calza. */
export function decide(rules, value) {
  if (typeof rules === 'string') return rules;
  if (!rules || typeof rules !== 'object') return 'ask';
  let res = 'ask';
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
    const got = decide(perm[tool], value);
    return { tool, value, expect, got, ok: got === expect };
  });
}

function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--file');
  const text = fi >= 0 ? fs.readFileSync(args[fi + 1], 'utf8') : fs.readFileSync(0, 'utf8');
  const cfg = extractJson(text);
  if (!cfg) { console.error('No pude leer la configuracion (esperaba la salida JSON de `opencode debug config`).'); process.exit(3); }
  const results = runProbes(cfg);
  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.tool.padEnd(4)} ${r.value}  -> ${r.got}${r.ok ? '' : ` (esperado ${r.expect})`}`);
  const bad = results.filter((r) => !r.ok);
  console.log(bad.length ? `\n${bad.length} sonda(s) FALLAN: la politica efectiva no es la que crees.` : `\nPolitica efectiva correcta (${results.length} sondas).`);
  process.exit(bad.length ? 1 : 0);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
