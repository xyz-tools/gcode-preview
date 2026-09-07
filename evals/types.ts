import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type Severity = 'critical' | 'major' | 'minor' | 'process';

export interface MustFind {
  /** Repo-relative path the review has to name. */
  file: string;
  /** The mechanism a real hit must describe. Read by the tier-2 judge, not by grade.ts. */
  defect: string;
  min_severity: Severity;
}

export interface EvalCase {
  id: string;
  skill: string;
  /** Where the fixture came from, e.g. "PR #392, defect reintroduced into current code". */
  source: string;
  expected_classes: string[];
  /** Empty means the correct review reports nothing — see `clean-docs-only`. */
  must_find: MustFind[];
  must_not_find: string[];
  runs: number;
  grading_note?: string;
}

/** A case whose correct output is no findings at all. */
export function expectsSilence(c: EvalCase): boolean {
  return c.must_find.length === 0;
}

function validate(raw: unknown, id: string): EvalCase {
  const c = raw as Partial<EvalCase>;
  const problems: string[] = [];
  if (c.id !== id) problems.push(`id "${c.id}" does not match directory "${id}"`);
  if (!c.skill) problems.push('missing skill');
  if (!Array.isArray(c.must_find)) problems.push('must_find must be an array');
  if (!Array.isArray(c.expected_classes)) problems.push('expected_classes must be an array');
  if (typeof c.runs !== 'number' || c.runs < 1) problems.push('runs must be a positive number');
  for (const f of c.must_find ?? []) {
    if (!f.file) problems.push('a must_find entry has no file');
    if (!f.defect) problems.push(`must_find for ${f.file} has no defect description`);
  }
  if (problems.length) throw new Error(`cases/${id}/case.json is invalid:\n  - ${problems.join('\n  - ')}`);
  return c as EvalCase;
}

export function loadCases(casesDir: string, only?: string): EvalCase[] {
  return readdirSync(casesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && (!only || e.name === only))
    .map((e) => {
      const file = join(casesDir, e.name, 'case.json');
      if (!existsSync(file)) throw new Error(`cases/${e.name} has no case.json`);
      return validate(JSON.parse(readFileSync(file, 'utf8')), e.name);
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
