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
  // enforcement y configuracion
  '.opencode/plugins/', 'factory/scripts/', 'factory/config.json', 'opencode.json', '.opencode/agent/', '.opencode/command/',
  '.hooks/', '.git/hooks/', '.git/config', '.github/', 'factory/templates/',
  // scripts del gate y del pipeline (si el agente los pudiera editar, podria volver verde cualquier cosa)
  '01-TOOLS/checks.sh', '01-TOOLS/risk.sh', '01-TOOLS/intake.js', '01-TOOLS/lib.sh', '01-TOOLS/new-job.sh',
  '01-TOOLS/launch-reviewers.sh', '01-TOOLS/validate-artifacts.sh',
  // lanzadores y reglas de conducta
  'factory-agent', 'factory-maint', 'AGENTS.md',
  // auditoria del guard: el agente puede leerla, no editarla ni resetear el modo parada
  'factory/logs/',
];

/** Palabras que un agente no tiene motivo para escribir: abren puertas traseras al guard o a los hooks. */
const BACKDOOR_RE = /factory-maint|FACTORY_GUARD_ALLOW_PROTECTED_EDIT|FACTORY_HUMAN\b/;
const INTERPRETERS = new Set(['python', 'python3', 'node', 'nodejs', 'deno', 'bun', 'perl', 'ruby', 'php', 'lua', 'pwsh', 'powershell']);
const ENV_MENTION_RE = /(^|[^\w])\.env(?!\w)(?![.\w]*(?:example|sample|template))/;

/** Ruta de destino protegida? Los directorios (terminan en "/") por prefijo; los archivos por nombre exacto. */
/** Evidencia del pipeline: solo la escriben los scripts (checks.sh, launch-reviewers.sh), nunca un agente a mano. */
const JOB_EVIDENCE_RE = /(^|\/)factory\/jobs\/[^/]+\/(gate\.md|round-[^/]+\/review-[^/]+\.md)$/;
export function isProtectedPath(target) {
  const t = String(target).replace(/\\/g, '/').replace(/^\.\//, '');
  if (JOB_EVIDENCE_RE.test(t)) return 'factory/jobs/<id>/gate.md y round-N/review-*.md (los escriben checks.sh y launch-reviewers.sh)';
  return PROTECTED_PATHS.find((p) => (p.endsWith('/') ? t.startsWith(p) || t.includes('/' + p) : t === p || t.endsWith('/' + p)));
}
/** El texto (codigo de un intérprete) menciona rutas protegidas o archivos .env? */
export function mentionsProtected(text) {
  return PROTECTED_PATHS.find((p) => String(text).includes(p)) || (ENV_MENTION_RE.test(text) ? '.env' : undefined);
}

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
// kind: 'grave'  = intento de hacer lo que la fabrica nunca debe hacer (tocar proteccion, secretos, main, merge,
//                  force, rodeos): cuenta para el modo parada rapido (3).
//       'policy' = error de FORMA recuperable (push sin rama explicita, `gh pr create` sin --draft, checkout main).
const block = (reason, kind = 'grave') => ({ blocked: true, reason, kind });
const grave = (reason) => block(reason, 'grave');
const soft = (reason) => block(reason, 'policy');
const FORCEISH = new Set(['-f', '--force', '--force-with-lease', '--delete', '-d', '--mirror', '--all', '--tags', '--prune']);

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
    if (c === '&' && (input[i - 1] === '>' || input[i + 1] === '>')) { cur += c; continue; } // 2>&1, >&2, &>
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

/**
 * Contenido de $( ... ) y `...` que SE EJECUTARIA: dentro de comillas dobles o sin comillas.
 * En comillas simples no se ejecuta nada; un backtick escapado (\`) es texto literal.
 */
function extractSubstitutions(input) {
  const out = [];
  let q = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (q === "'") { if (c === "'") q = null; continue; }
    if (c === '\\') { i++; continue; }
    if (q === '"') { if (c === '"') { q = null; continue; } }
    else if (c === "'") { q = "'"; continue; }
    else if (c === '"') { q = '"'; continue; }
    if (c === '`') {
      const j = input.indexOf('`', i + 1);
      if (j < 0) { out.push(input.slice(i + 1)); break; }
      out.push(input.slice(i + 1, j)); i = j; continue;
    }
    if (c === '$' && input[i + 1] === '(') {
      let d = 1; let j = i + 2;
      while (j < input.length && d > 0) { if (input[j] === '(') d++; else if (input[j] === ')') d--; j++; }
      out.push(input.slice(i + 2, d === 0 ? j - 1 : j)); i = j - 1;
    }
  }
  return out;
}

/**
 * Separa los cuerpos de heredoc (<<EOF ... EOF) del resto del comando.
 * El cuerpo es DATO (por ejemplo codigo JS), no una lista de comandos, salvo que lo reciba un shell
 * (bash/sh/eval/source). Si el delimitador no va entre comillas, solo se ejecutan sus $( ) y backticks.
 */
function splitHeredocs(command) {
  const lines = command.split('\n');
  const out = [];
  const bodies = [];
  const interpBodies = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const pending = [];
    const re = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;
    let m;
    while ((m = re.exec(line))) {
      if (line[m.index - 1] === '<') continue; // here-string <<<
      const pre = line.slice(0, m.index).split(/[;&|]/).pop() || '';
      pending.push({ dash: m[1] === '-', quoted: m[2] !== '', delim: m[3], pre });
    }
    for (const h of pending) {
      const body = [];
      while (i + 1 < lines.length) {
        i++;
        const cand = h.dash ? lines[i].replace(/^\t+/, '') : lines[i];
        if (cand === h.delim) break;
        body.push(lines[i]);
      }
      const head = stripWrappers(tokenize(h.pre));
      const recv = head.length ? head[0].split('/').pop() : '';
      const text = body.join('\n');
      if (SHELLS.has(recv) || ['eval', 'source', '.'].includes(recv)) bodies.push(text);
      else if (INTERPRETERS.has(recv.replace(/[0-9.]+$/, ''))) interpBodies.push(text);
      else if (!h.quoted) bodies.push(...extractSubstitutions(text));
    }
  }
  return { text: out.join('\n'), bodies, interpBodies };
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
      if (!PUSH_OK_FLAGS.has(a)) return (FORCEISH.has(a) || a.startsWith('--force') ? grave : soft)(`git push con la opcion ${a} esta prohibido. ${hint}`);
      continue;
    }
    pos.push(a);
  }
  if (pos.some((x) => x.startsWith('+') || /(^|:)(main|master)$/.test(x))) return grave(`git push a main/master o con + esta prohibido. ${hint}`);
  if (pos.length !== 2) return soft(`git push sin remoto y rama explicitos (o con varias ramas) esta prohibido. ${hint}`);
  const [remote, ref] = pos;
  if (!REMOTE_RE.test(remote)) return grave(`El remoto "${remote}" no es un nombre simple (URLs prohibidas). ${hint}`);
  const parts = ref.split(':');
  if (parts.length > 2) return soft(`Refspec invalido. ${hint}`);
  const [src, dst] = parts.length === 2 ? parts : [ref, ref];
  if (!AGENT_BRANCH_RE.test(dst) || !(src === 'HEAD' || AGENT_BRANCH_RE.test(src))) {
    return soft(`git push solo se permite a ramas factory/<job-id>; "${ref}" no cumple. Nunca a main/master. ${hint}`);
  }
  return ok();
}

function classifyGit(args) {
  const { sub, rest } = gitSubcommand(args);
  if (!sub) return ok();
  if (rest.includes('--no-verify')) return grave('--no-verify esta prohibido (salta los hooks de proteccion).');
  if (args.some((a) => /hookspath/i.test(a))) return grave('Cambiar core.hooksPath (tambien con git -c) esta prohibido: desactiva los hooks.');
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
        return soft(`branch-guard: no se permite cambiar a ${target}. Trabaja en una rama/worktree propia.`);
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
      return soft('gh pr create solo se permite con --draft.');
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


/** Separa con un espacio los operadores > que van pegados a una palabra (echo x>f), respetando comillas. */
function spaceRedirects(seg) {
  let out = ''; let q = null;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) { out += c; if (c === '\\' && q === '"' && i + 1 < seg.length) { out += seg[++i]; continue; } if (c === q) q = null; continue; }
    if (c === '\\' && i + 1 < seg.length) { out += c + seg[++i]; continue; }
    if (c === '"' || c === "'") { q = c; out += c; continue; }
    if (c === '>' || (c === '&' && seg[i + 1] === '>')) {
      const prev = out[out.length - 1];
      if (prev && !/\s/.test(prev) && prev !== '>' && prev !== '&') {
        const m = out.match(/(^|\s)(\d+)$/); // N> es descriptor, no se separa
        if (!m) out += ' ';
      }
    }
    out += c;
  }
  return out;
}

/** Destinos de redireccion (>, >>, &>, N>, >|) de un comando. Ignora duplicados de descriptor (2>&1, >&2, >&-). */
export function redirectTargets(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(/^(\d*|&)(>>?|>\|)(.*)$/s);
    if (!m) continue;
    let rest = m[3];
    if (rest.startsWith('&')) {
      const fd = rest.slice(1);
      if (/^(\d+|-)$/.test(fd)) continue; // 2>&1, >&2, >&-
      rest = fd; // >&archivo (stdout+stderr al archivo)
    }
    if (!rest) rest = tokens[i + 1] || '';
    if (rest) out.push(rest);
  }
  return out;
}

const pathHit = (a) => {
  const x = String(a).replace(/^['"]|['"]$/g, '');
  return isProtectedPath(x) || isProtectedPath(x.replace(/\/+$/, '') + '/');
};
const nonFlags = (args) => args.filter((a) => !a.startsWith('-'));
// Comandos cuyo efecto es escribir/borrar/crear en TODOS sus argumentos de ruta.
const WRITE_ANY = new Set(['tee', 'rm', 'rmdir', 'unlink', 'shred', 'chmod', 'chown', 'chgrp', 'ln', 'truncate', 'install', 'touch', 'mkdir', 'mv']);

/** Devuelve la ruta protegida que este comando simple ESCRIBE (no la que solo lee o ejecuta). */
function protectedWriteHit(t, tokens) {
  for (const target of redirectTargets(tokens)) { const h = pathHit(target); if (h) return h; }
  if (!t.length) return undefined;
  const cmd = t[0].split('/').pop();
  const args = t.slice(1);
  if (WRITE_ANY.has(cmd)) { for (const a of nonFlags(args)) { const h = pathHit(a); if (h) return h; } }
  if (cmd === 'cp') { const a = nonFlags(args); const h = a.length ? pathHit(a[a.length - 1]) : undefined; if (h) return h; }
  if ((cmd === 'sed' || cmd === 'perl') && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) {
    for (const a of nonFlags(args)) { const h = pathHit(a); if (h) return h; }
  }
  if (cmd === 'dd') { for (const a of args) if (a.startsWith('of=')) { const h = pathHit(a.slice(3)); if (h) return h; } }
  if (cmd === 'git') {
    const { sub, rest } = gitSubcommand(args);
    if (['restore', 'rm', 'mv', 'checkout', 'stash', 'apply', 'am'].includes(sub)) {
      for (const a of nonFlags(rest)) { const h = pathHit(a); if (h) return h; }
    }
  }
  return undefined;
}

function classifySimple(tokens, raw, opts, depth) {
  const head = tokens.filter((a) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a));
  if (head[0] && head[0].split('/').pop() === 'env' && head.slice(1).every((a) => a.startsWith('-'))) {
    return grave('Listar variables de entorno esta prohibido (pueden contener el token del agente).');
  }
  if (!opts.allowProtected) {
    for (const tk of tokens) {
      const m = tk.match(/^[A-Za-z_][A-Za-z0-9_]*=(.*)$/s);
      if (m && (mentionsProtected(m[1]) || isEnvFile(m[1]))) return grave('Asignar una ruta protegida a una variable es un rodeo del guard (ej. CFG="opencode.json"). Pide el cambio al humano.');
    }
  }
  const t = stripWrappers(tokens);
  if (!t.length) return ok();
  const cmd = t[0].split('/').pop();
  if (!opts.allowProtected && INTERPRETERS.has(cmd.replace(/[0-9.]+$/, ''))) {
    const ci = t.findIndex((a, i) => i > 0 && /^(-[a-zA-Z]*[ce]|-p|--eval|--print|--command)$/.test(a));
    const code = ci >= 0 ? t.slice(ci + 1).join(' ') : '';
    const hit = code && mentionsProtected(code);
    if (hit) return grave(`El codigo en linea de ${cmd} menciona ${hit} (archivo protegido o .env). Eso es un rodeo del guard: pide el cambio al humano.`);
  }

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
  if (cmd === 'printenv' || (cmd === 'export' && t.slice(1).every((a) => a === '-p')) || (cmd === 'set' && t.length === 1)) {
    return grave('Listar variables de entorno esta prohibido (pueden contener el token del agente).');
  }
  if (/\$\{?(GH_TOKEN|GITHUB_TOKEN|GITHUB_PAT|[A-Z_]*API_KEY|[A-Z_]*SECRET[A-Z_]*)\b/.test(raw) || /\/proc\/[^\s]*environ/.test(raw)) {
    return grave('Leer o imprimir tokens/secretos del entorno esta prohibido.');
  }
  if (!ENV_OK.has(cmd) && t.slice(1).some(isEnvFile)) return grave('Leer o copiar archivos .env esta prohibido.');

  if (!opts.allowProtected) {
    const hit = protectedWriteHit(t, tokens);
    if (hit) return grave(`Modificar ${hit} esta prohibido para agentes (archivo protegido de la factory). Leer o ejecutar esa ruta SI esta permitido.`);
  }
  return ok();
}

export function classifyBash(command, opts = {}, depth = 0) {
  if (typeof command !== 'string' || !command.trim()) {
    return block('No pude leer el comando bash (formato de herramienta inesperado). Bloqueado por seguridad.');
  }
  if (depth > MAX_DEPTH) return block('Comando demasiado anidado. Bloqueado por seguridad.');
  if (!opts.allowProtected && BACKDOOR_RE.test(command)) {
    return grave('Mencionar factory-maint, FACTORY_GUARD_ALLOW_PROTECTED_EDIT o FACTORY_HUMAN esta prohibido para agentes: desactivan las protecciones.');
  }
  const { text, bodies, interpBodies } = splitHeredocs(command);
  if (!opts.allowProtected) {
    for (const body of interpBodies) {
      const hit = mentionsProtected(body);
      if (hit) return grave(`El codigo ejecutado por un interprete menciona ${hit} (archivo protegido o .env). Eso es un rodeo del guard: pide el cambio al humano.`);
    }
  }
  for (const inner of [...extractSubstitutions(text), ...bodies]) {
    const r = classifyBash(inner, opts, depth + 1);
    if (r.blocked) return r;
  }
  for (const seg of splitSegments(text.replace(/>\|/g, '>'))) {
    const r = classifySimple(tokenize(spaceRedirects(seg)), seg, opts, depth);
    if (r.blocked) return r;
  }
  return ok();
}

/** Rutas que una herramienta de escritura va a modificar (no el contenido que escribe). */
export function targetPaths(tool, args = {}) {
  const paths = [];
  for (const k of ['filePath', 'file_path', 'path', 'filename', 'file']) if (typeof args[k] === 'string') paths.push(args[k]);
  if (Array.isArray(args.edits)) for (const e of args.edits) if (e && typeof e.filePath === 'string') paths.push(e.filePath);
  for (const k of ['patchText', 'patch', 'input', 'diff']) {
    if (typeof args[k] !== 'string') continue;
    for (const m of args[k].matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gm)) paths.push(m[1].trim());
    for (const m of args[k].matchAll(/^\*\*\* Move to:\s*(.+)$/gm)) paths.push(m[1].trim());
    for (const m of args[k].matchAll(/^(?:---|\+\+\+) (?:[ab]\/)?(\S+)/gm)) if (m[1] !== '/dev/null') paths.push(m[1]);
    for (const m of args[k].matchAll(/^diff --git a\/(\S+) b\/(\S+)/gm)) paths.push(m[1], m[2]);
  }
  return paths;
}

/** Herramientas que no son bash (read/edit/write/patch...). */
export function classifyTool(tool, args = {}, opts = {}) {
  const name = String(tool || '').toLowerCase();
  if (READ_TOOLS.has(name)) {
    const target = args.filePath || args.path || args.pattern || '';
    if (isEnvFile(target)) return grave('Leer archivos .env esta prohibido.');
  }
  if (WRITE_TOOLS.has(name)) {
    const paths = targetPaths(name, args);
    if (!paths.length) return block(`No pude determinar que archivo modifica la herramienta ${name}. Bloqueado por seguridad.`);
    for (const target of paths) {
      if (isEnvFile(target)) return grave('Escribir archivos .env esta prohibido.');
      if (!opts.allowProtected) {
        const hit = isProtectedPath(target);
        if (hit) return grave(`Modificar ${hit} esta prohibido para agentes (archivo protegido de la factory).`);
      }
    }
  }
  return ok();
}
