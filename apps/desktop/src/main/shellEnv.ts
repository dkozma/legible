// GUI apps on macOS start with a minimal PATH. Agents and git need the user's
// real PATH (Homebrew git, ~/.local/bin/claude), so read it from a login shell.

import { execFile } from 'node:child_process';

export async function loadShellPath(): Promise<void> {
  if (process.platform === 'win32') return;
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  const marker = '__LEGIBLE_PATH__';
  const out = await new Promise<string>((resolve) => {
    execFile(
      shell,
      ['-ilc', `printf '${marker}%s${marker}' "$PATH"`],
      { timeout: 5000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      (_err, stdout) => resolve(stdout ?? ''),
    );
  });
  const m = out.match(new RegExp(`${marker}(.*)${marker}`));
  if (!m?.[1]) return;
  const merged = new Set([...m[1].split(':'), ...(process.env.PATH ?? '').split(':')].filter(Boolean));
  process.env.PATH = [...merged].join(':');
}
