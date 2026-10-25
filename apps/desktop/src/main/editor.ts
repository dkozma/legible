// "Open in editor" at a line. Editors with URL handlers open through the OS;
// $VISUAL / $EDITOR is spawned directly.

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

import type { EditorChoice } from '@legible/domain';
import { shell } from 'electron';

export async function openInEditor(editor: EditorChoice, file: string, line: number): Promise<{ ok: boolean; error: string | null }> {
  try {
    await access(file);
  } catch {
    return { ok: false, error: `${file} doesn't exist in the working tree.` };
  }
  const enc = encodeURI(file);
  switch (editor) {
    case 'vscode':
      await shell.openExternal(`vscode://file${enc}:${line}`);
      return { ok: true, error: null };
    case 'cursor':
      await shell.openExternal(`cursor://file${enc}:${line}`);
      return { ok: true, error: null };
    case 'zed':
      await shell.openExternal(`zed://file${enc}:${line}`);
      return { ok: true, error: null };
    case 'idea':
      await shell.openExternal(`idea://open?file=${encodeURIComponent(file)}&line=${line}`);
      return { ok: true, error: null };
    case 'env': {
      const cmd = process.env.VISUAL || process.env.EDITOR;
      if (!cmd) return { ok: false, error: 'Neither $VISUAL nor $EDITOR is set.' };
      const [bin, ...args] = cmd.split(' ').filter(Boolean);
      const child = spawn(bin as string, [...args, `+${line}`, file], { detached: true, stdio: 'ignore' });
      child.on('error', () => undefined);
      child.unref();
      return { ok: true, error: null };
    }
  }
}
