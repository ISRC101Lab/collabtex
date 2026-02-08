/**
 * Extract \label{} keys and BibTeX entry keys from project file contents.
 */

const LABEL_RE = /\\label\{([^}]+)\}/g;
const BIBKEY_RE = /^@\w+\{([^,\s]+)/gm;

export interface ProjectLabels {
  labels: string[];   // \label{...} keys
  bibKeys: string[];  // BibTeX @type{key, ...} keys
}

/**
 * Extract labels from a .tex file content string.
 */
export function extractLabels(texContent: string): string[] {
  const results: string[] = [];
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(texContent)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

/**
 * Extract citation keys from a .bib file content string.
 */
export function extractBibKeys(bibContent: string): string[] {
  const results: string[] = [];
  BIBKEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BIBKEY_RE.exec(bibContent)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}
