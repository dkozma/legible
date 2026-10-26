export {
  buildFileDiff,
  type FileDiffInput,
  hash,
  isTrivialLine,
} from "./analyze"
export {
  type ClassifyInput,
  collapseReason,
  INDENTATION_SENSITIVE,
  LARGE_FILE_BYTES,
  extensionsFor,
  languageForPath,
  looksBinary,
} from "./classify"
export {
  canHighlight,
  highlightLines,
  MAX_HIGHLIGHT_CHARS,
  scopeAt,
} from "./highlight"
export {
  diffLines,
  histogramMatches,
  internLines,
  myersMatches,
  splitLines,
  toChunks,
} from "./lineDiff"
export { detectMoves, MIN_MOVE_LINES, type MoveInputFile } from "./moves"
export { lineSimilarity, pairLines, tokenize, wordDiff } from "./wordDiff"
