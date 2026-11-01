/**
 * command-guard.mjs
 * Logica PURA (sin Bun, sin OpenCode) para decidir si un comando o una llamada
 * a herramienta debe bloquearse. La usan el plugin factory-guard.js y los tests.
 *
 * Es una red de seguridad, NO un sandbox: un modelo determinado puede ofuscar
 * comandos (python -c, scripts propios...). La proteccion real de main es la
 * branch protection de GitHub y no dar al agente credenciales con permiso de
 * push/merge a main.
 */

// Rutas que los agentes NO deben modificar (el guard, el gate, la config...).
export const PROTECTED_PATHS = [
  '.opencode/plugins/factory-guard.js',
  'factory/scripts/command-guard.mjs',
  'factory/config.json',
  '.hooks/',
  '01-TOOLS/checks.sh',
  '01-TOOLS/risk.sh',
  '01-TOOLS/intake.js',
  '.opencode/agent/',
  '.opencode/command/',
  'opencode.json',
  '.git/hooks',
  '.git/config',
];

const WRAPPERS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'exec', 'nice', 'xargs', 'timeout', 'stdbuf']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const ENV_OK = new Set(['ls', 'stat', 'test', '[', 'echo']);
const WRITE_TOOLS = new Set(['edit', 'write', 'patch', 'multiedit', 'apply_patch']);
const READ_TOOLS = new Set(['read', 'grep', 'glob', 'list']);
const ENV_FILE_RE = /(^|[\\/])\.env(\.[^\\/\s]+)?$|[^\\/\s]\.env$/;
const ENV_SAFE_RE = /\.(example|sample|template)$/;
const MAX_DEPTH = 6;

/** Unicas ramas que un agente puede subir: factory/<job-id>[/...] (sin `..`). Nunca main/master. */
export const AGENT_BRANCH_RE = /^factory\/(?!.*\.\.)[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const PUSH_OK_FLAGS = new Set(['-u', '--set-upstream', '-q', '--quiet', '-v', '--verbose', '--porcelain', '--progress', '--no-progress']);
const REMOTE_RE = /^[A-Za-z0-9._-]+$/;

const ok = () => ({ blocked: false });
const block = (reason) => ({ blocked: true, reason });

function isEnvFile(token) {
  const t = String(token).replace(/^['"]|['"]$/g, '');
  return ENV_FILE_RE.test(t) && !ENV_SAFE_RE.test(t);
}

/** Divide por separadores shell sin cortar dentro de comillas. */
export function splitSegments(input) {
  const segments = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"' && i + 1 < input.length) { cur += input[++i]; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\\' && i + 1 < input.length) { cur += c + input[++i]; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (';&|\n()`'.includes(c)) { if (cur.trim()) segments.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) segments.push(cur);
  return segments;
}

/** Tokeniza una palabra shell quitando comillas. */
export function tokenize(segment) {
  const tokens = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < segment.length) { cur += segment[++i]; continue; }
      if (c === quote) { quote = null; continue; }
      cur += c;
      continue;
    }
    if (c === '\\' && i + 1 < segment.length) { cur += segment[++i]; has = true; continue; }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (/\s/.test(c)) { if (has || cur) tokens.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (has || cur) tokens.push(cur);
  return tokens;
}

/** Contenido de $( ... ) y `...` (tambien dentro de comillas dobles). */
function extractSubstitutions(input) {
  const out = [];
  for (const m of input.matchAll(/\$\(([^()]*)\)/g)) out.push(m[1]);
  for (const m of input.matchAll(/`([^`]*)`/g)) out.push(m[1]);
  return out;
}

function stripWrappers(tokens) {
  let t = tokens.slice();
  for (let guard = 0; guard < 20 && t.length; guard++) {
    const first = t[0].split('/').pop();
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) { t.shift(); continue; }
    if (WRAPPERS.has(first)) {
      t.shift();
      while (t.length && (t[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]) || /^\d+[smhd]?$/.test(t[0]))) {
        const flag = t.shift();
        if ((first === 'sudo' && (flag === '-u' || flag === '-g')) && t.length) t.shift();
      }
      continue;
    }
    break;
  }
  return t;
}

function gitSubcommand(args) {
  const withValue = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix']);
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (withValue.has(a)) { i += 2; continue; }
    if (a.startsWith('-')) { i += 1; continue; }
    return { sub: a, rest: args.slice(i + 1) };
  }
  return { sub: null, rest: [] };
}

function classifyPush(rest) {
  const hint = 'Un agente solo puede ejecutar: git push [-u] <remoto> factory/<job-id>';
  const pos = [];
  for (const a of rest) {
    if (a.startsWith('-')) {
      if (!PUSH_OK_FLAGS.has(a)) return block(`git push con la opcion ${a} esta prohibido. ${hint}`);
      continue;
    }
    pos.push(a);
  }
  if (pos.length !== 2) return block(`git push sin remoto y rama explicitos (o con varias ramas) esta prohibido. ${hint}`);
  const [remote, ref] = pos;
  if (!REMOTE_RE.test(remote)) return block(`El remoto "${remote}" no es un nombre simple (URLs prohibidas). ${hint}`);
  const parts = ref.split(':');
  if (parts.length > 2) return block(`Refspec invalido. ${hint}`);
  const [src, dst] = parts.length === 2 ? parts : [ref, ref];
  if (!AGENT_BRANCH_RE.test(dst) || !(src === 'HEAD' || AGENT_BRANCH_RE.test(src))) {
    return block(`git push solo se permite a ramas factory/<job-id>; "${ref}" no cumple. Nunca a main/master. ${hint}`);
  }
  return ok();
}

function classifyGit(args) {
  const { sub, rest } = gitSubcommand(args);
  if (!sub) return ok();
  if (rest.includes('--no-verify')) return block('--no-verify esta prohibido (salta los hooks de proteccion).');
  switch (sub) {
    case 'push': return classifyPush(rest);
    case 'merge': return block('git merge esta prohibido para agentes. El merge lo hace un humano.');
    case 'update-ref':
    case 'filter-branch': return block(`git ${sub} esta prohibido.`);
    case 'reset': return rest.includes('--hard') ? block('git reset --hard esta prohibido.') : ok();
    case 'clean': return rest.some((a) => /^-[a-z]*f/.test(a) || a === '--force') ? block('git clean -f esta prohibido.') : ok();
    case 'branch': {
      const del = rest.some((a) => ['-d', '-D', '--delete'].includes(a));
      return del && rest.some((a) => /^(origin\/)?(main|master)$/.test(a)) ? block('No se puede borrar main/master.') : ok();
    }
    case 'config': return rest.some((a) => /hookspath/i.test(a)) ? block('No se puede cambiar core.hooksPath.') : ok();
    case 'checkout':
    case 'switch': {
      const creates = rest.some((a) => ['-b', '-B', '-c', '-C', '--orphan', '--detach', '--'].includes(a));
      const target = rest.find((a) => !a.startsWith('-'));
      if (!creates && target && /^(main|master)$/.test(target)) {
        return block(`branch-guard: no se permite cambiar a ${target}. Trabaja en una rama/worktree propia.`);
      }
      return ok();
    }
    default: return ok();
  }
}

function classifyGh(args) {
  const withValue = new Set(['-R', '--repo', '--hostname']);
  let i = 0;
  while (i < args.length) {
    if (withValue.has(args[i])) { i += 2; continue; }
    if (args[i].startsWith('--repo=') || args[i].startsWith('--hostname=')) { i += 1; continue; }
    break;
  }
  const group = args[i];
  const sub = args[i + 1];
  const rest = args.slice(i + 2);
  if (group === 'pr') {
    if (sub === 'merge') return block('gh pr merge esta prohibido para agentes.');
    if (sub === 'ready') return block('gh pr ready esta prohibido: los PR quedan en borrador hasta que un humano decida.');
    if (sub === 'review' && rest.some((a) => a === '--approve' || a === '-a')) return block('Los agentes no pueden aprobar PRs.');
    if (sub === 'create' && !rest.some((a) => a === '--draft' || a === '-d')) {
      return block('gh pr create solo se permite con --draft.');
    }
    return ok();
  }
  if (group === 'api') {
    const rest = args.slice(i + 1);
    const method = rest.findIndex((a) => a === '-X' || a === '--method');
    const m = method >= 0 ? String(rest[method + 1] || '').toUpperCase() : (rest.find((a) => a.startsWith('--method=')) || '').slice(9).toUpperCase();
    const mutating = (m && m !== 'GET') || rest.some((a) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(a));
    return mutating ? block('gh api con metodo mutante esta prohibido.') : ok();
  }
  if (group === 'auth' && (sub === 'token' || sub === 'refresh')) return block('gh auth token/refresh esta prohibido (exfiltracion de credenciales).');
  if (group === 'secret' || group === 'variable' || group === 'ssh-key') return block(`gh ${group} esta prohibido.`);
  if (group === 'repo' && sub === 'delete') return block('gh repo delete esta prohibido.');
  return ok();
}

function classifySimple(tokens, raw, opts, depth) {
  const head = tokens.filter((a) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a));
  if (head[0] && head[0].split('/').pop() === 'env' && head.slice(1).every((a) => a.startsWith('-'))) {
    return block('Listar variables de entorno esta prohibido (pueden contener el token del agente).');
  }
  const t = stripWrappers(tokens);
  if (!t.length) return ok();
  const cmd = t[0].split('/').pop();

  if (SHELLS.has(cmd)) {
    const ci = t.findIndex((a) => /^-[a-zA-Z]*c$/.test(a));
    if (ci >= 0 && t[ci + 1] !== undefined) return classifyBash(t[ci + 1], opts, depth + 1);
  }
  if (cmd === 'eval') return classifyBash(t.slice(1).join(' '), opts, depth + 1);
  if (cmd === 'git') { const r = classifyGit(t.slice(1)); if (r.blocked) return r; }
  if (cmd === 'gh') { const r = classifyGh(t.slice(1)); if (r.blocked) return r; }
  if (cmd === 'rm') {
    const flags = t.slice(1).filter((a) => /^-[a-zA-Z]+$/.test(a)).join('');
    const long = t.slice(1);
    const rec = /[rR]/.test(flags) || long.includes('--recursive');
    const force = /f/.test(flags) || long.includes('--force');
    if (rec && force) return block('rm -rf esta prohibido.');
  }
  if (['printenv', 'export'].includes(cmd) || (cmd === 'set' && t.length === 1)) {
    return block('Listar variables de entorno esta prohibido (pueden contener el token del agente).');
  }
  if (/\$\{?(GH_TOKEN|GITHUB_TOKEN|GITHUB_PAT|[A-Z_]*API_KEY|[A-Z_]*SECRET[A-Z_]*)\b/.test(raw) || /\/proc\/[^\s]*environ/.test(raw)) {
    return block('Leer o imprimir tokens/secretos del entorno esta prohibido.');
  }
  if (!ENV_OK.has(cmd) && t.slice(1).some(isEnvFile)) return block('Leer o copiar archivos .env esta prohibido.');

  if (!opts.allowProtected) {
    const mentions = PROTECTED_PATHS.find((p) => raw.includes(p));
    const writes = /\b(tee|cp|mv|rm|chmod|chown|ln|truncate|dd|install)\b|\bsed\s+[^|;&]*-[a-zA-Z]*i|\bperl\s+[^|;&]*-[a-zA-Z]*i|>/.test(raw);
    if (mentions && writes) return block(`Modificar ${mentions} esta prohibido para agentes (archivo protegido de la factory).`);
  }
  return ok();
}

export function classifyBash(command, opts = {}, depth = 0) {
  if (typeof command !== 'string' || !command.trim()) {
    return block('No pude leer el comando bash (formato de herramienta inesperado). Bloqueado por seguridad.');
  }
  if (depth > MAX_DEPTH) return block('Comando demasiado anidado. Bloqueado por seguridad.');
  for (const inner of extractSubstitutions(command)) {
    const r = classifyBash(inner, opts, depth + 1);
    if (r.blocked) return r;
  }
  for (const seg of splitSegments(command)) {
    const r = classifySimple(tokenize(seg), seg, opts, depth);
    if (r.blocked) return r;
  }
  return ok();
}

/** Herramientas que no son bash (read/edit/write/patch...). */
export function classifyTool(tool, args = {}, opts = {}) {
  const name = String(tool || '').toLowerCase();
  const blob = JSON.stringify(args || {});
  if (READ_TOOLS.has(name)) {
    const target = args.filePath || args.path || args.pattern || '';
    if (isEnvFile(target)) return block('Leer archivos .env esta prohibido.');
  }
  if (WRITE_TOOLS.has(name)) {
    const target = args.filePath || args.path || '';
    if (isEnvFile(target)) return block('Escribir archivos .env esta prohibido.');
    if (!opts.allowProtected) {
      const hit = PROTECTED_PATHS.find((p) => blob.includes(p));
      if (hit) return block(`Modificar ${hit} esta prohibido para agentes (archivo protegido de la factory).`);
    }
  }
  return ok();
}
