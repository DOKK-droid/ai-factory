// factory-guard.js — red de seguridad de la AI Factory (OpenCode plugin).
// La logica vive en factory/scripts/command-guard.mjs (pura y testeada con `npm test`).
// Importante: en OpenCode los argumentos de la herramienta llegan en `output.args`
// (no en `input.args`). Si el formato fuera otro, el guard BLOQUEA bash (falla cerrado)
// en lugar de dejar pasar todo en silencio.
import { classifyBash, classifyTool } from "../../factory/scripts/command-guard.mjs";

export const factoryGuard = async () => ({
  "tool.execute.before": async (input, output) => {
    const tool = String(input?.tool ?? "").toLowerCase();
    const args = output?.args ?? input?.args ?? {};
    const opts = { allowProtected: process.env.FACTORY_GUARD_ALLOW_PROTECTED_EDIT === "1" };
    const verdict = tool === "bash"
      ? classifyBash(args.command, opts)
      : classifyTool(tool, args, opts);
    if (verdict.blocked) {
      throw new Error(`BLOCKED by factory-guard: ${verdict.reason}`);
    }
  },
});
