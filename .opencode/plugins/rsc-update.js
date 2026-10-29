// rsc-update:managed
// rsc update check for OpenCode: checked once per OpenCode run, and the notice goes to the model to be
// relayed. It rides on EVERY system prompt of the run, not just the first: OpenCode's first call is
// its title generator, which would swallow a once-only notice before the agent ever sees it.
// One file for both plugin APIs (issue #289): V1 calls the named export or server(); V2 reads id + setup.
// Turn auto-update off with .rsc/.no-auto-update.
import { updateNotice } from '../../.rsc/auto-update.mjs';

const NOTE = '\nMention this only in your first reply of the session.';
const check = (cwd) => (process.env.RSC_NO_UPDATE_CHECK ? Promise.resolve('') : updateNotice(cwd).catch(() => ''));

export const RscUpdatePlugin = async ({ directory, worktree }) => {
  const pending = check(worktree || directory);
  return {
    'experimental.chat.system.transform': async (_input, output) => {
      const said = (await pending).trim();
      if (said && Array.isArray(output?.system)) output.system.push(said + NOTE);
    },
  };
};

export default {
  id: 'rsc.update',
  server: RscUpdatePlugin,
  async setup(ctx) {
    const pending = check(ctx.location?.project?.directory || ctx.location?.directory || process.cwd());
    await ctx.session.hook('context', async (event) => {
      const said = (await pending).trim();
      if (said && Array.isArray(event?.system)) event.system.push({ type: 'text', text: said + NOTE });
    });
  },
};
