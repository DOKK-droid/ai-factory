// rsc-knowledge:managed
// rsc knowledge sync for OpenCode. OpenCode has no prompt event and no channel to the person, so what
// sync has to say goes to the model, to be relayed. Cheap on every call: the fetch is throttled and
// every notice is said once. Turn it off with `rsc knowledge-sync off`.
// One file for both plugin APIs (issue #289): V1 calls the named export or server(); V2 reads id + setup.
import { onRequest, onTurn } from '../../.rsc/knowledge-sync.mjs';

const local = () => process.env.RSC_REMOTE_AGENT !== '1' && process.env.OPENCODE_REMOTE !== '1';
const tell = (cwd) => {
  if (!local()) return '';
  try { const said = onRequest(cwd); return said ? `Cuéntale esto al usuario en una línea:\n${said}` : ''; } catch { return ''; }
};
const turn = (cwd) => { if (local()) { try { onTurn(cwd); } catch { /* fail open */ } } };

export const RscKnowledgePlugin = async ({ directory, worktree }) => {
  const cwd = worktree || directory;
  return {
    'experimental.chat.system.transform': async (_input, output) => {
      const text = tell(cwd);
      if (text && Array.isArray(output?.system)) output.system.push(text);
    },
    event: async ({ event }) => { if (event?.type === 'session.idle') turn(cwd); },
  };
};

// V2 has no session.idle: a turn ends with session.execution.succeeded (or .failed).
export default {
  id: 'rsc.knowledge',
  server: RscKnowledgePlugin,
  async setup(ctx) {
    const cwd = ctx.location?.project?.directory || ctx.location?.directory || process.cwd();
    await ctx.session.hook('context', async (event) => {
      const text = tell(cwd);
      if (text && Array.isArray(event?.system)) event.system.push({ type: 'text', text });
    });
    const stop = new AbortController();
    (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: stop.signal })) {
          if (event?.type === 'session.execution.succeeded' || event?.type === 'session.execution.failed') turn(cwd);
        }
      } catch { /* unloading, or the stream ended: fail open */ }
    })();
    return () => stop.abort();
  },
};
