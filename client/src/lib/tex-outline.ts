/** Parse LaTeX sectioning commands into a hierarchical outline. */

export interface OutlineEntry {
  level: number;       // 0=part, 1=chapter, 2=section, 3=subsection, 4=subsubsection
  command: string;     // e.g. "section"
  title: string;       // text inside braces
  line: number;        // 1-based line number
  children: OutlineEntry[];
}

const SECTION_COMMANDS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
};

const SECTION_RE = /\\(part|chapter|section|subsection|subsubsection)\*?\s*\{([^}]*)\}/g;

/**
 * Parse a .tex source string and return a tree of outline entries.
 */
export function parseTexOutline(source: string): OutlineEntry[] {
  const root: OutlineEntry[] = [];
  const lines = source.split('\n');

  // Flat list first
  const flat: OutlineEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    SECTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SECTION_RE.exec(line)) !== null) {
      flat.push({
        level: SECTION_COMMANDS[m[1]],
        command: m[1],
        title: m[2].trim(),
        line: i + 1,
        children: [],
      });
    }
  }

  if (flat.length === 0) return root;

  // Build tree using a stack
  const stack: { entry: OutlineEntry; level: number }[] = [];

  for (const entry of flat) {
    // Pop stack until we find a parent with lower level
    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(entry);
    } else {
      stack[stack.length - 1].entry.children.push(entry);
    }

    stack.push({ entry, level: entry.level });
  }

  return root;
}
