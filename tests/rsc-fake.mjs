// npx / npm simulados para rsc-pin.sh: sin red y sin instalar nada. Imitan lo que se midio ejecutando RSC 3.6.0 en vivo
// (onboard en dos pasadas, knowledge-sync off, git-permissions off, sync que deriva .rsc.json de los marcadores, AGENTS.md respetado,
// opencode.json reescrito). Los fallos se provocan con variables FAKE_*:
//   FAKE_INTEGRITY=<sha>        integridad que devuelve `npm view` (por defecto la del pin)
//   FAKE_SYNC_NO_AUTOUPDATE=1   sync NO registra auto-update (la hipotesis que se comprobo falsa en 3.6.0)
//   FAKE_CLOBBER_AGENTS=1       onboard sustituye AGENTS.md en vez de anadir su bloque
//   FAKE_OPENCODE_KEEP=1        RSC no toca opencode.json
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmp, write } from './helpers.mjs';

export const PLAN = 'ab'.repeat(32);
export const PIN = JSON.parse(fs.readFileSync(path.join(REPO, 'factory/rsc-pin.json'), 'utf8'));

/** Carpeta con `npx` y `npm` falsos; se antepone al PATH. `log` = una linea por llamada. */
export function fakeBin() {
  const dir = tmp('af-rscbin-'); const log = path.join(dir, 'calls.log');
  for (const tool of ['npx', 'npm']) {
    write(path.join(dir, tool), `#!/usr/bin/env bash\nexec node "${new URL(import.meta.url).pathname}" ${tool} "$@"\n`);
    fs.chmodSync(path.join(dir, tool), 0o755);
  }
  return { dir, log, env: (extra = {}) => ({ ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_LOG: log, ...extra }), calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) };
}

// ---- el simulador: solo corre cuando se ejecuta como `node rsc-fake.mjs npx|npm ...` ----
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [tool, ...args] = process.argv.slice(2); const env = process.env;
  fs.appendFileSync(env.FAKE_LOG, [tool, ...args].join(' ') + '\n');
  if (tool === 'npm') { process.stdout.write((env.FAKE_INTEGRITY !== undefined ? env.FAKE_INTEGRITY : PIN.integrity) + '\n'); process.exit(0); }
  const [, pkg, cmd, ...rest] = args; const version = pkg.split('@').pop();
  const cwd = process.cwd(); const mf = path.join(cwd, '.rsc.json'); const oc = path.join(cwd, 'opencode.json');
  const rd = () => JSON.parse(fs.readFileSync(mf, 'utf8')); const wr = (j) => fs.writeFileSync(mf, JSON.stringify(j, null, 2) + '\n');
  const ocRead = () => (fs.existsSync(oc) ? JSON.parse(fs.readFileSync(oc, 'utf8')) : { permission: { bash: {} } });
  const ocWrite = (j) => { if (!env.FAKE_OPENCODE_KEEP) fs.writeFileSync(oc, JSON.stringify(j, null, 2) + '\n'); };
  const GIT = ['git commit', 'git commit *', 'git push', 'git push *', 'gh pr create *'];
  const wireGit = (on) => { const j = ocRead(); j.permission = j.permission || {}; j.permission.bash = j.permission.bash || {}; for (const k of GIT) { if (on) j.permission.bash[k] = 'allow'; else delete j.permission.bash[k]; } ocWrite(j); };
  const sync = () => {
    const j = rd(); const keep = (j.optOuts || []).filter((o) => o !== 'knowledge-sync' && o !== 'auto-update');
    if (fs.existsSync(path.join(cwd, '.rsc/.no-knowledge-sync'))) keep.push('knowledge-sync');
    if (fs.existsSync(path.join(cwd, '.rsc/.no-auto-update')) && !env.FAKE_SYNC_NO_AUTOUPDATE) keep.push('auto-update');
    j.optOuts = keep.sort(); wr(j); wireGit(j.gitPermissions === true);
  };
  if (cmd === 'onboard') {
    if (!rest.includes('--accept-plan')) { console.log(`plan de instalacion\nAccept exactly this plan: npx ${pkg} onboard ${rest.join(' ')} --accept-plan ${PLAN}`); process.exit(0); }
    if (rest[rest.indexOf('--accept-plan') + 1] !== PLAN) { console.error('RSC_PLAN_CHANGED'); process.exit(1); }
    fs.mkdirSync(path.join(cwd, '.rsc'), { recursive: true });
    wr({ version: 1, targets: ['opencode'], optOuts: [], catalogVersion: version, gitPermissions: true });
    const block = '<!-- rsc-suggest:start -->\n# rsc-suggest\n<!-- rsc-suggest:end -->\n';
    const agents = path.join(cwd, 'AGENTS.md'); const prev = fs.existsSync(agents) ? fs.readFileSync(agents, 'utf8') : '';
    fs.writeFileSync(agents, env.FAKE_CLOBBER_AGENTS ? block : (prev ? prev.trimEnd() + '\n\n\n' : '') + block);
    wireGit(true); console.log(`RSC_ONBOARDING_READY ${PLAN}`); process.exit(0);
  }
  if (!fs.existsSync(mf)) { console.error('No .rsc.json here: install the harness first'); process.exit(2); }
  if (cmd === 'knowledge-sync' && rest[0] === 'off') { fs.mkdirSync(path.join(cwd, '.rsc'), { recursive: true }); fs.writeFileSync(path.join(cwd, '.rsc/.no-knowledge-sync'), ''); sync(); process.exit(0); }
  if (cmd === 'git-permissions' && rest[0] === 'off') { wr({ ...rd(), gitPermissions: false }); sync(); process.exit(0); }
  if (cmd === 'sync') { sync(); console.log('Synced opencode'); process.exit(0); }
  console.error(`comando simulado desconocido: ${cmd}`); process.exit(2);
}
