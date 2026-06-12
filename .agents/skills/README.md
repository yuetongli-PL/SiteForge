# Repository Skills

Codex scans repository skills from `.agents/skills` when it starts inside this
repository. The `x-live-actions` skill is checked in here so another machine can
clone the repository and use the same X read-only SiteForge workflow.

## Mac Setup

1. Clone or pull this repository on the Mac.
2. Start Codex from the repository root, or from any subdirectory inside the
   repository.
3. Restart Codex if the skill list was already loaded before pulling the files.
4. Invoke the skill explicitly with `$X只读动作`, or ask for a matching X/Twitter
   read-only SiteForge task and let Codex select it implicitly.

Repository skills are project-scoped. To use this skill outside this repository,
copy `.agents/skills/x-live-actions` to `~/.agents/skills/x-live-actions` on the
target machine.
