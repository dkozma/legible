// Legible's provider-neutral tools. Defined once; adapted to an in-process
// MCP server for Claude and to function tools for OpenAI (M3). All of these
// read git objects, so agents never need a checkout, a shell, or the network.

import { z } from 'zod';
import type { ToolContext } from './types';

export interface LegibleTool<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  /** Object shape. Every field required (nullable instead of optional) so OpenAI strict mode accepts it. */
  input: S;
  readOnly: boolean;
  handler: (input: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<string>;
}

const side = z.enum(['base', 'head']).describe('"base" is before the change, "head" is after it');
const MAX_LINES = 400;
const MAX_CHARS = 40_000;

function rev(ctx: ToolContext, s: 'base' | 'head') {
  return s === 'base' ? ctx.baseSha : ctx.headSha;
}

function safePath(p: string): string {
  const clean = p.replace(/^\/+/, '');
  if (clean.split('/').some((seg) => seg === '..') || clean.includes('\0') || clean.includes('\n')) {
    throw new Error(`Invalid path: ${p}`);
  }
  return clean;
}

function clip(text: string): string {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n… (truncated)` : text;
}

/** A tool with its input type erased, so tools with different inputs share one list. */
export interface AnyLegibleTool {
  name: string;
  description: string;
  input: z.ZodRawShape;
  readOnly: boolean;
  handler: (input: never, ctx: ToolContext) => Promise<string>;
}

function define<S extends z.ZodRawShape>(t: LegibleTool<S>): AnyLegibleTool {
  return t as unknown as AnyLegibleTool;
}

export const TOOLS: AnyLegibleTool[] = [
  define({
    name: 'get_change_set_summary',
    description: 'Lists every file changed in the Change Set under review, with status and line counts.',
    input: {},
    readOnly: true,
    async handler(_input, ctx) {
      if (ctx.changedFiles.length === 0) return 'No files changed.';
      return ctx.changedFiles
        .map(
          (f) =>
            `${f.status.padEnd(9)} ${f.oldPath && f.oldPath !== f.path ? `${f.oldPath} → ` : ''}${f.path} (+${f.additions} −${f.deletions})`,
        )
        .join('\n');
    },
  }),
  define({
    name: 'read_file',
    description: `Reads a file at Base or Head with line numbers. At most ${MAX_LINES} lines per call.`,
    input: {
      side,
      path: z.string().describe('Repository-relative path'),
      startLine: z.number().int().nullable().describe('1-based first line, or null for the start'),
      endLine: z.number().int().nullable().describe('1-based last line, or null'),
    },
    readOnly: true,
    async handler({ side: s, path, startLine, endLine }, ctx) {
      const buf = await ctx.repo.blobs().readPath(rev(ctx, s), safePath(path));
      if (!buf) return `${path} does not exist at ${s}.`;
      const lines = buf.toString('utf8').split('\n');
      const from = Math.max(1, startLine ?? 1);
      const to = Math.min(lines.length, endLine ?? from + MAX_LINES - 1, from + MAX_LINES - 1);
      const out: string[] = [];
      for (let i = from; i <= to; i++) out.push(`${String(i).padStart(5)}  ${lines[i - 1]}`);
      const more = to < lines.length ? `\n… ${lines.length - to} more lines` : '';
      return clip(out.join('\n') + more);
    },
  }),
  define({
    name: 'list_files',
    description: 'Lists files at Base or Head, optionally under a directory.',
    input: { side, directory: z.string().nullable().describe('Directory prefix, or null for the whole repository') },
    readOnly: true,
    async handler({ side: s, directory }, ctx) {
      const files = await ctx.repo.listFiles(rev(ctx, s), directory ? safePath(directory) : undefined);
      const shown = files.slice(0, 500);
      return shown.join('\n') + (files.length > shown.length ? `\n… ${files.length - shown.length} more` : '');
    },
  }),
  define({
    name: 'search',
    description: 'Searches file contents at Base or Head (git grep, extended regex). Returns path:line:text matches.',
    input: {
      side,
      pattern: z.string(),
      path: z.string().nullable().describe('Limit to a path or glob, or null'),
      ignoreCase: z.boolean(),
    },
    readOnly: true,
    async handler({ side: s, pattern, path, ignoreCase }, ctx) {
      const hits = await ctx.repo.grep(rev(ctx, s), pattern, { pathspec: path ? safePath(path) : undefined, ignoreCase, maxCount: 50 });
      if (hits.length === 0) return 'No matches.';
      const shown = hits.slice(0, 200);
      return clip(shown.join('\n') + (hits.length > shown.length ? `\n… ${hits.length - shown.length} more` : ''));
    },
  }),
  define({
    name: 'git_log',
    description: 'Recent commits at Head, optionally for one path.',
    input: { path: z.string().nullable(), maxCount: z.number().int().nullable() },
    readOnly: true,
    async handler({ path, maxCount }, ctx) {
      const log = await ctx.repo.log(ctx.headSha, { path: path ? safePath(path) : undefined, maxCount: Math.min(maxCount ?? 20, 50) });
      return log.map((c) => `${c.sha.slice(0, 10)} ${c.date} ${c.author}: ${c.subject}`).join('\n') || 'No commits.';
    },
  }),
  define({
    name: 'git_blame',
    description: 'Who last changed each line in a range of a file at Head, and in which commit.',
    input: { path: z.string(), startLine: z.number().int(), endLine: z.number().int() },
    readOnly: true,
    async handler({ path, startLine, endLine }, ctx) {
      const end = Math.min(endLine, startLine + 200);
      const lines = await ctx.repo.blame(ctx.headSha, safePath(path), startLine, end);
      return clip(
        lines.map((l) => `${String(l.line).padStart(5)} ${l.sha.slice(0, 8)} ${l.author.padEnd(16).slice(0, 16)} ${l.text}`).join('\n'),
      );
    },
  }),
];

export const READ_TOOLS: string[] = TOOLS.filter((t) => t.readOnly).map((t) => t.name);

export function grantedTools(names: string[]): AnyLegibleTool[] {
  const set = new Set(names);
  return TOOLS.filter((t) => set.has(t.name));
}

/** One-line description of a tool call for progress display. */
export function summarizeToolCall(name: string, input: Record<string, unknown>): string {
  const bare = name.replace(/^mcp__legible__/, '');
  switch (bare) {
    case 'read_file':
      return `Reading ${input.path}${input.startLine ? `:${input.startLine}` : ''} (${input.side})`;
    case 'search':
      return `Searching for ${JSON.stringify(input.pattern)}`;
    case 'list_files':
      return `Listing ${input.directory ?? 'files'}`;
    case 'git_log':
      return `Reading history${input.path ? ` of ${input.path}` : ''}`;
    case 'git_blame':
      return `Blaming ${input.path}:${input.startLine}`;
    case 'get_change_set_summary':
      return 'Reading the Change Set summary';
    default:
      return bare;
  }
}
