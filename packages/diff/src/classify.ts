// Path- and content-based classification: language, lockfiles, generated and vendored files.

import type { CollapseReason } from '@legible/domain';

const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  m: 'objectivec',
  mm: 'objectivec',
  cs: 'csharp',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  xml: 'xml',
  svg: 'xml',
  plist: 'xml',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  clj: 'clojure',
  elm: 'elm',
  tf: 'hcl',
  hcl: 'hcl',
  nix: 'nix',
  zig: 'zig',
  ml: 'ocaml',
};

const NAME_LANG: Record<string, string> = {
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  GNUmakefile: 'makefile',
  Rakefile: 'ruby',
  Gemfile: 'ruby',
  'CMakeLists.txt': 'cmake',
  '.bashrc': 'shell',
  '.zshrc': 'shell',
};

export function languageForPath(path: string): string | null {
  const name = path.split('/').pop() ?? path;
  if (NAME_LANG[name]) return NAME_LANG[name] as string;
  if (name.startsWith('Dockerfile')) return 'dockerfile';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return EXT_LANG[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** Languages where leading whitespace is meaningful. */
export const INDENTATION_SENSITIVE = new Set([
  'python',
  'yaml',
  'makefile',
  'haskell',
  'elm',
  'markdown',
  'nix',
  'sass',
  'coffee',
  'pug',
  'shell',
  'dockerfile',
]);

/**
 * Languages whose Lezer grammar marks every string, template and heredoc
 * fully, so whitespace outside strings can be compared safely. Markdown,
 * HTML, YAML, Ruby, shell and the rest are left out: blank lines, indentation
 * and trailing spaces carry meaning there (paragraphs, <pre>, block scalars,
 * heredocs).
 */
export const WHITESPACE_PROOF_LANGUAGES = new Set([
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'java',
  'c',
  'cpp',
  'csharp',
  'rust',
  'go',
  'kotlin',
  'dart',
  'php',
  'json',
  'python',
  'css',
  'scss',
  'less',
]);

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'pdm.lock',
  'composer.lock',
  'go.sum',
  'flake.lock',
  'Podfile.lock',
  'Package.resolved',
  'packages.lock.json',
  'mix.lock',
  'pubspec.lock',
  'gradle.lockfile',
  'conan.lock',
]);

const GENERATED_PATTERNS: RegExp[] = [
  /\.min\.(js|css|mjs)$/,
  /\.(js|css)\.map$/,
  /\.pb\.(go|cc|h)$/,
  /_pb2(_grpc)?\.pyi?$/,
  /\.g\.dart$/,
  /\.freezed\.dart$/,
  /\.generated\.[a-z]+$/,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /(^|\/)__generated__\//,
];

const VENDORED_PATTERNS: RegExp[] = [/(^|\/)node_modules\//, /(^|\/)vendor\//, /(^|\/)third_party\//, /(^|\/)\.yarn\/releases\//];

const GENERATED_MARKERS = /@generated|DO NOT EDIT|Code generated .* DO NOT EDIT|auto-?generated|This file is generated/i;

export interface ClassifyInput {
  path: string;
  /** First lines of the Head (or Base, for deletions) content. */
  headText?: string | null;
  /** From .gitattributes, when available. */
  attributes?: { generated?: boolean; vendored?: boolean };
  sizeBytes?: number;
}

export const LARGE_FILE_BYTES = 1_500_000;

export function collapseReason(input: ClassifyInput): CollapseReason | null {
  const name = input.path.split('/').pop() ?? input.path;
  if (LOCKFILES.has(name)) return 'lockfile';
  if (input.attributes?.generated) return 'generated';
  if (input.attributes?.vendored) return 'vendored';
  if (GENERATED_PATTERNS.some((re) => re.test(input.path))) return 'generated';
  if (VENDORED_PATTERNS.some((re) => re.test(input.path))) return 'vendored';
  if (input.headText) {
    const head = input.headText.split('\n', 6).join('\n');
    if (GENERATED_MARKERS.test(head)) return 'generated';
  }
  if (input.sizeBytes !== undefined && input.sizeBytes > LARGE_FILE_BYTES) return 'large';
  return null;
}

/** Git's heuristic: a NUL byte in the first 8000 bytes means binary. */
export function looksBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}
