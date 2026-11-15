/**
 * Whether a line carries only a comment, and so cannot end a slicer's
 * description of a layer.
 * @param line - A single line of G-code, without its newline
 * @returns True when the line's first non-blank character opens a comment
 */
function isCommentOnly(line: string): boolean {
  return line.trimStart().startsWith(';');
}

/**
 * Separates the run of comment-only lines that ends `text` from the rest.
 * @param text - Complete lines, newline-separated, with no trailing newline
 * @returns `parse`, the lines before the run, and `hold`, the run itself
 */
function splitOffCommentRun(text: string): { parse: string; hold: string } {
  let runStart = text.length;
  let end = text.length;

  while (end > 0) {
    const newline = text.lastIndexOf('\n', end - 1);
    if (!isCommentOnly(text.slice(newline + 1, end))) break;
    runStart = newline + 1;
    end = newline;
  }

  if (runStart === text.length) return { parse: text, hold: '' };
  if (runStart === 0) return { parse: '', hold: text };

  // runStart - 1 is the newline between the two, and belongs to neither
  return { parse: text.slice(0, runStart - 1), hold: text.slice(runStart) };
}

/**
 * Rejoins the lines held back with the partial line that follows them.
 * @param held - Complete comment lines being carried, newline-separated
 * @param partial - The unterminated line at the end of the chunk
 * @returns The two joined, ready to be prepended to the next chunk
 * @remarks
 * The held lines keep the newline that terminated the last of them. Only the
 * partial line ends the tail without one -- it is the one the next chunk
 * continues; the held lines are whole, and dropping their terminator would
 * glue the next chunk's first characters onto the last of them.
 */
function joinTail(held: string, partial: string): string {
  return held === '' ? partial : `${held}\n${partial}`;
}

/**
 * Splits a streamed chunk into the lines that are complete and the part to
 * carry into the next chunk.
 *
 * @param tail - Partial line, and any held comment lines, from the last chunk
 * @param chunk - Newly read chunk of G-code text
 * @returns `complete`, ready to parse, and the new `tail`
 *
 * @remarks
 * The returned `tail` excludes the newline itself, so prepending it to the
 * next chunk never fabricates an empty line at a chunk boundary.
 *
 * A chunk containing no newline at all completes nothing: the whole chunk is
 * carried into the tail, so a line is only ever parsed once its terminating
 * newline (or the end of the stream) has arrived.
 *
 * Comment lines that end a chunk are carried too. A slicer describes a layer
 * in a run of them -- `;LAYER_CHANGE`, then `;Z:`, then `;HEIGHT:` -- and a
 * chunk ends wherever the bytes ran out, so the description can be cut in
 * half. Whatever reads the comments would then see a layer whose values are
 * in the next chunk. A run of comments is never the end of anything, so
 * holding it costs nothing: the G-code line that closes it brings it along.
 */
export function splitChunk(tail: string, chunk: string): { complete: string; tail: string } {
  const idxNewLine = chunk.lastIndexOf('\n');

  if (idxNewLine < 0) {
    return { complete: '', tail: tail + chunk };
  }

  const { parse, hold } = splitOffCommentRun(tail + chunk.slice(0, idxNewLine));

  return { complete: parse, tail: joinTail(hold, chunk.slice(idxNewLine + 1)) };
}
