/**
 * Splits a streamed chunk into the lines that are complete and the partial
 * line to carry into the next chunk.
 *
 * @param tail - Partial line left over from the previous chunk
 * @param chunk - Newly read chunk of G-code text
 * @returns `complete`, ready to parse, and the new `tail`
 *
 * @remarks
 * The returned `tail` excludes the newline itself, so prepending it to the
 * next chunk never fabricates an empty line at a chunk boundary.
 *
 * `complete` keeps its final newline: every newline in it terminates one
 * line, which is exactly how the parser reads strings. A trailing newline
 * would otherwise be ambiguous — `'A\n'` completing lines `A` and `''` here,
 * but line `A` alone in a whole-file parse.
 *
 * A chunk containing no newline at all completes nothing: `complete` is empty
 * (which parses to zero lines) and the whole chunk is carried into the tail,
 * so a line is only ever parsed once its terminating newline (or the end of
 * the stream) has arrived.
 */
export function splitChunk(tail: string, chunk: string): { complete: string; tail: string } {
  const idxNewLine = chunk.lastIndexOf('\n');

  if (idxNewLine < 0) {
    return { complete: '', tail: tail + chunk };
  }

  return { complete: tail + chunk.slice(0, idxNewLine + 1), tail: chunk.slice(idxNewLine + 1) };
}
