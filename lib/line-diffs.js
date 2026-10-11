// Both comparisons end in the current buffer. Keep index-to-buffer hunks
// primary, and show HEAD-to-buffer hunks as staged only outside those ranges.
// Deletions use Git's preceding-line anchor; their empty modified range starts
// at the following line, matching the editor range used by VS Code quick diff.
function modifiedRange({ newStart, newLines }) {
  const start = newLines === 0 ? newStart + 1 : newStart;
  return { start, end: start + newLines };
}

function combineLineDiffs(unstaged, staged) {
  const primaryRanges = unstaged.map(modifiedRange);
  const diffs = unstaged.map((diff) => ({ ...diff, stage: "unstaged" }));
  // Worker hunks are ordered and disjoint. Walk both lists once so a heavily
  // edited buffer does not block the renderer with a quadratic overlap scan.
  let primaryIndex = 0;
  for (const diff of staged) {
    const range = modifiedRange(diff);
    while (primaryIndex < primaryRanges.length && primaryRanges[primaryIndex].end < range.start) {
      primaryIndex++;
    }
    if (primaryRanges[primaryIndex]?.start <= range.end) continue;
    diffs.push({ ...diff, stage: "staged" });
  }
  return diffs.sort((left, right) => left.newStart - right.newStart);
}

module.exports = { combineLineDiffs };
