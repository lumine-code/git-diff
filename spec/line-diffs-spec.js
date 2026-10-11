describe("Git diff baseline precedence", () => {
  let combineLineDiffs;
  const modified = (row, lines = 1) => ({
    oldStart: row,
    oldLines: lines,
    newStart: row,
    newLines: lines,
  });

  beforeEach(() => {
    ({ combineLineDiffs } = require("../lib/line-diffs"));
  });

  it("keeps disjoint staged and unstaged changes in buffer order", () => {
    expect(combineLineDiffs([modified(8)], [modified(2)])).toEqual([
      { ...modified(2), stage: "staged" },
      { ...modified(8), stage: "unstaged" },
    ]);
  });

  it("hides the whole staged hunk when any of its lines overlap unstaged", () => {
    expect(combineLineDiffs([modified(4)], [modified(2, 4)])).toEqual([
      { ...modified(4), stage: "unstaged" },
    ]);
  });

  it("gives unstaged precedence for touching ranges on either side", () => {
    expect(combineLineDiffs([modified(4)], [modified(3), modified(5)])).toEqual([
      { ...modified(4), stage: "unstaged" },
    ]);
  });

  it("anchors a deletion's empty range after its preceding-line marker", () => {
    const removed = { oldStart: 5, oldLines: 1, newStart: 4, newLines: 0 };
    expect(combineLineDiffs([removed], [modified(3), modified(4), modified(5)])).toEqual([
      { ...modified(3), stage: "staged" },
      { ...removed, stage: "unstaged" },
    ]);
  });

  it("handles deletions before the first line and identical empty ranges", () => {
    const removed = { oldStart: 1, oldLines: 1, newStart: 0, newLines: 0 };
    expect(combineLineDiffs([removed], [removed, modified(1), modified(3)])).toEqual([
      { ...removed, stage: "unstaged" },
      { ...modified(3), stage: "staged" },
    ]);
  });
});
