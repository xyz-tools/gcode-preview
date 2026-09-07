import type { CommandHandler } from '../../interpreter';

/**
 * Matches the extrusion-dimension comments of the PrusaSlicer family
 * (PrusaSlicer, SuperSlicer, OrcaSlicer, Bambu Studio): `;WIDTH:0.45` and
 * `;HEIGHT:0.16`. The parser has already stripped the `;` and trimmed the
 * text; whitespace around the colon and after the value is tolerated. The
 * value must be a plain decimal number — trailing junk (`0.45mm`) rejects the
 * line rather than being silently truncated by parseFloat.
 */
const dimensionPattern = /^(WIDTH|HEIGHT)\s*:\s*(\d*\.?\d+(?:[eE][+-]?\d+)?)\s*$/i;

/**
 * Executes a standalone comment line
 * @param command - GCodeCommand carrying only a comment
 * @param job - Job instance to update
 * @remarks
 * Reads the `;WIDTH:` / `;HEIGHT:` dimension comments slicers emit ahead of the
 * moves they apply to, and stores them on the state as the extrusion width and
 * line height for paths created from here on. `;HEIGHT:` is how adaptive layer
 * height reaches the preview: the value changes throughout the file, and each
 * path keeps the height that was current when it was created. The path itself
 * is not touched here — the move handlers compare their in-progress path
 * against the state and break it when these values have changed, which keeps
 * a streamed parse identical to a one-shot parse: `Interpreter.execute`
 * resumes the last path at every chunk boundary, so a break performed at
 * comment time would be undone whenever a chunk happened to end on a comment.
 * Non-numeric and non-positive values are ignored, as are all other comments.
 */
export const comment: CommandHandler = (command, job) => {
  if (command.comment === undefined) {
    return;
  }

  const match = dimensionPattern.exec(command.comment);
  if (match === null) {
    return;
  }

  const value = parseFloat(match[2]);
  if (!Number.isFinite(value) || value <= 0) {
    return;
  }

  if (match[1].toUpperCase() === 'WIDTH') {
    job.state.extrusionWidth = value;
  } else {
    job.state.lineHeight = value;
  }
};
