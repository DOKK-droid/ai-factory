// factory-guard.js — red de seguridad de la AI Factory (OpenCode plugin).
// La logica de clasificacion vive en factory/scripts/command-guard.mjs (pura y testeada con `npm test`).
//
// Politica ante bloqueos (dos contadores, porque no todos los bloqueos pesan igual):
//  * GRAVES (tocar archivos protegidos, rodeos, secretos): FACTORY_GUARD_MAX_BLOCKS, 3 por defecto.
//  * POLITICA (push mal formado, `gh pr create` sin --draft...): FACTORY_GUARD_MAX_POLICY_BLOCKS, 10 por defecto.
//  * Al llegar a cualquiera de los dos la sesion entra en MODO PARADA: solo herramientas de lectura.
//    Se escribe factory/logs/BLOCKED.md. Cada bloqueo queda en factory/logs/blocked.log (JSON por linea).
//  * Salir del modo parada SIN reiniciar OpenCode: el humano, desde SU terminal, ejecuta `touch factory/logs/RESET`.
//    (factory/logs/ esta protegido: un agente no puede crear ese archivo.)
//  * En OpenCode los argumentos llegan en `output.args`. Si el formato fuese otro, bash se BLOQUEA (falla cerrado).
// No es un sandbox: la defensa real es la config managed, el ruleset y que el token no pueda tocar main.
import fs from "node:fs";
import path from "node:path";
import { classifyBash, classifyTool } from "../../factory/scripts/command-guard.mjs";

const READ_ONLY = new Set(["read", "grep", "glob", "list", "todoread", "webfetch"]);
const HINT = "No reintentes ni rodees el bloqueo: si falta un permiso de escritura, DELEGA en el agente o script que produce ese artefacto; si no, explica al humano que necesitas y espera.";

export const factoryGuard = async (ctx = {}) => {
  const root = ctx.directory || process.cwd();
  const logDir = path.join(root, "factory", "logs");
  const maxGrave = Number(process.env.FACTORY_GUARD_MAX_BLOCKS || 3);
  const maxPolicy = Number(process.env.FACTORY_GUARD_MAX_POLICY_BLOCKS || 10);
  let strikes = 0;
  let policy = 0;
  let stopped = false;

  const checkReset = () => {
    try {
      const flag = path.join(logDir, "RESET");
      if (!fs.existsSync(flag)) return;
      fs.rmSync(flag, { force: true });
      fs.rmSync(path.join(logDir, "BLOCKED.md"), { force: true });
      strikes = 0; policy = 0; stopped = false;
    } catch { /* si no se puede resetear, sigue detenido */ }
  };

  const record = (tool, args, verdict) => {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      const detail = String(args?.command ?? args?.filePath ?? args?.path ?? "").slice(0, 240);
      fs.appendFileSync(path.join(logDir, "blocked.log"), JSON.stringify({ ts: new Date().toISOString(), tool, kind: verdict.kind, reason: verdict.reason, detail }) + "\n");
      if (stopped) {
        fs.writeFileSync(path.join(logDir, "BLOCKED.md"),
          `# Sesion detenida por factory-guard\n\nGraves: ${strikes}/${maxGrave} · Politica: ${policy}/${maxPolicy}.\n` +
          `Revisa factory/logs/blocked.log, decide que cambio hace falta y, desde TU terminal, ejecuta:\n\n    touch factory/logs/RESET\n\n` +
          `Ultimo bloqueo (${verdict.kind}): ${verdict.reason}\n`);
      }
    } catch { /* el registro nunca debe romper al guard */ }
  };

  return {
    "tool.execute.before": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase();
      const args = output?.args ?? input?.args ?? {};
      const opts = { allowProtected: process.env.FACTORY_GUARD_ALLOW_PROTECTED_EDIT === "1" };

      if (stopped) checkReset();
      if (stopped && !READ_ONLY.has(tool) && !opts.allowProtected) {
        throw new Error(`BLOCKED by factory-guard: STOP. Sesion detenida (ver factory/logs/BLOCKED.md). El humano debe ejecutar \`touch factory/logs/RESET\`. ${HINT}`);
      }
      const verdict = tool === "bash" ? classifyBash(args.command, opts) : classifyTool(tool, args, opts);
      if (!verdict.blocked) return;

      if (verdict.kind === "grave") strikes += 1; else policy += 1;
      if (strikes >= maxGrave || policy >= maxPolicy) stopped = true;
      record(tool, args, verdict);
      const left = verdict.kind === "grave" ? `grave ${strikes}/${maxGrave}` : `politica ${policy}/${maxPolicy}`;
      throw new Error(`BLOCKED by factory-guard: ${verdict.reason} ${HINT}${stopped ? " (SESION DETENIDA)" : ` (${left})`}`);
    },
  };
};
