export const factoryGuard = async ({ project, directory }) => {
  const forbidden = [
    /^git\s+push\b/,
    /^git\s+push\s+/,
    /^git\s+merge\b/,
    /^git\s+merge\s+/,
    /^gh\s+pr\s+merge\b/,
    /^gh\s+pr\s+merge\s+/,
  ];

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return;

      const cmd = input.args?.command || "";

      // Deny directo: push / merge / pr merge
      for (const re of forbidden) {
        if (re.test(cmd.trim())) {
          throw new Error(
            `BLOCKED by factoryGuard: "${cmd}" is not allowed. Use a PR and wait for human approval instead.`
          );
        }
      }

      // Branch guard: si es checkout a main/master o worktree add, verificar branch-guard.sh
      if (/^git\s+(checkout|switch)\s+(main|master)(\s|$)/.test(cmd.trim())) {
        const { $ } = await import("bun:test");
        try {
          await $`bash .hooks/branch-guard.sh main`;
        } catch (e) {
          throw new Error(`BLOCKED by branch-guard: ${e.message}`);
        }
      }

      // Ship guard: si es gh pr create, verificar que existe human.md con FAST_PATH
      if (/^gh\s+pr\s+create/.test(cmd.trim())) {
        const fs = await import("fs");
        const path = await import("path");
        // Buscar human.md en factory/jobs más cercano
        const jobDirs = fs.readdirSync(path.join(directory, "factory", "jobs"), { withFileTypes: true });
        let hasApproved = false;
        for (const entry of jobDirs) {
          if (!entry.isDirectory()) continue;
          const humanPath = path.join(directory, "factory", "jobs", entry.name, "human.md");
          if (fs.existsSync(humanPath)) {
            const content = fs.readFileSync(humanPath, "utf8");
            if (/^FAST_PATH/m.test(content)) {
              hasApproved = true;
              break;
            }
          }
        }
        if (!hasApproved) {
          throw new Error(
            "BLOCKED by ship-guard: gh pr create requires human.md with FAST_PATH. Run /factory pipeline first."
          );
        }
      }
    },
  };
};
