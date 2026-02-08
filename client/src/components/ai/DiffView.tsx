import { useState, useMemo } from 'react';
import type { FileChange } from '@/api/client';
import './DiffView.css';

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
}

interface DiffBlock {
  id: number;
  lines: DiffLine[];
  hasChanges: boolean;
}

function computeDiff(oldText: string | null, newText: string | null): DiffLine[] {
  const oldLines = (oldText ?? '').split('\n');
  const newLines = (newText ?? '').split('\n');

  if (!oldText && newText) {
    return newLines.map((l, i) => ({ type: 'add', content: l, newLine: i + 1 }));
  }
  if (oldText && !newText) {
    return oldLines.map((l, i) => ({ type: 'remove', content: l, oldLine: i + 1 }));
  }

  // Simple LCS-based diff
  const result: DiffLine[] = [];
  let oi = 0, ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      result.push({ type: 'context', content: oldLines[oi], oldLine: oi + 1, newLine: ni + 1 });
      oi++; ni++;
    } else {
      // Find next matching line
      let bestOi = -1, bestNi = -1, bestDist = Infinity;
      const searchLimit = Math.min(20, Math.max(oldLines.length - oi, newLines.length - ni));

      for (let d = 1; d <= searchLimit; d++) {
        for (let s = 0; s <= d; s++) {
          const checkOi = oi + s;
          const checkNi = ni + (d - s);
          if (checkOi < oldLines.length && checkNi < newLines.length && oldLines[checkOi] === newLines[checkNi]) {
            if (d < bestDist) { bestDist = d; bestOi = checkOi; bestNi = checkNi; }
            break;
          }
        }
        if (bestDist <= d) break;
      }

      if (bestOi >= 0) {
        while (oi < bestOi) {
          result.push({ type: 'remove', content: oldLines[oi], oldLine: oi + 1 });
          oi++;
        }
        while (ni < bestNi) {
          result.push({ type: 'add', content: newLines[ni], newLine: ni + 1 });
          ni++;
        }
      } else {
        while (oi < oldLines.length) {
          result.push({ type: 'remove', content: oldLines[oi], oldLine: oi + 1 });
          oi++;
        }
        while (ni < newLines.length) {
          result.push({ type: 'add', content: newLines[ni], newLine: ni + 1 });
          ni++;
        }
      }
    }
  }

  return result;
}

function groupIntoBlocks(lines: DiffLine[], contextSize = 3): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let blockId = 0;
  let current: DiffLine[] = [];
  let contextBuffer: DiffLine[] = [];

  const flushBlock = () => {
    if (current.length > 0) {
      const hasChanges = current.some((l) => l.type !== 'context');
      blocks.push({ id: blockId++, lines: current, hasChanges });
      current = [];
    }
  };

  for (const line of lines) {
    if (line.type === 'context') {
      contextBuffer.push(line);
      if (contextBuffer.length > contextSize * 2) {
        // End current block with trailing context
        current.push(...contextBuffer.splice(0, contextSize));
        flushBlock();
        // Keep remaining as leading context for next block
        contextBuffer = contextBuffer.slice(-contextSize);
      }
    } else {
      current.push(...contextBuffer);
      contextBuffer = [];
      current.push(line);
    }
  }

  current.push(...contextBuffer);
  flushBlock();

  return blocks;
}

interface DiffViewProps {
  change: FileChange;
  onAccept?: () => void;
  onReject?: () => void;
}

export default function DiffView({ change, onAccept, onReject }: DiffViewProps) {
  const [expanded, setExpanded] = useState(true);

  const { blocks, addCount, removeCount } = useMemo(() => {
    const diffLines = computeDiff(change.oldContent, change.newContent);
    const blks = groupIntoBlocks(diffLines);
    return {
      blocks: blks,
      addCount: diffLines.filter((l) => l.type === 'add').length,
      removeCount: diffLines.filter((l) => l.type === 'remove').length,
    };
  }, [change.oldContent, change.newContent]);

  const actionLabel = change.action === 'create' ? 'Created'
    : change.action === 'delete' ? 'Deleted'
    : 'Modified';

  return (
    <div className="diff-view">
      <div className="diff-view__header" onClick={() => setExpanded((v) => !v)}>
        <span className="diff-view__chevron">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className={`diff-view__badge diff-view__badge--${change.action}`}>
          {actionLabel}
        </span>
        <span className="diff-view__path">{change.path}</span>
        <span className="diff-view__stats">
          {addCount > 0 && <span className="diff-view__stat-add">+{addCount}</span>}
          {removeCount > 0 && <span className="diff-view__stat-remove">-{removeCount}</span>}
        </span>
        <div className="diff-view__actions">
          {onAccept && (
            <button
              className="diff-view__action-btn diff-view__action-btn--accept"
              onClick={(e) => { e.stopPropagation(); onAccept(); }}
              title="Accept change"
            >
              &#x2713;
            </button>
          )}
          {onReject && (
            <button
              className="diff-view__action-btn diff-view__action-btn--reject"
              onClick={(e) => { e.stopPropagation(); onReject(); }}
              title="Reject change"
            >
              &#x2717;
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="diff-view__body">
          {blocks.map((block) => (
            <div key={block.id} className="diff-view__block">
              {block.lines.map((line, i) => (
                <div key={i} className={`diff-view__line diff-view__line--${line.type}`}>
                  <span className="diff-view__gutter">
                    {line.oldLine ?? ' '}
                  </span>
                  <span className="diff-view__gutter">
                    {line.newLine ?? ' '}
                  </span>
                  <span className="diff-view__marker">
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                  </span>
                  <span className="diff-view__code">{line.content}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
