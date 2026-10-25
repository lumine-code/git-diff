describe("Git Diff destination scrolling", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let editor, lineView, listView;

  beforeEach(async () => {
    await lumine.packages.activatePackage("git-diff");
    const GitDiffView = require("../lib/git-diff-view");
    const DiffListView = require("../lib/diff-list-view");
    jasmine.attachToDOM(lumine.workspace.getElement());
    editor = await lumine.workspace.open();
    editor.setText("first\n    changed\n   \nlast");
    lineView = Object.create(GitDiffView.prototype);
    lineView.editor = editor;
    listView = new DiffListView(() => []);
    await listView.toggle();
    lumine.config.set("editor.scrollZone", [25, 75]);
  });

  afterEach(async () => {
    await listView.destroy();
    editor.destroy();
  });

  for (const route of ["line command", "hunk picker"]) {
    for (const [row, column] of [
      [1, 4],
      [2, 0],
    ]) {
      it(`reveals ${route} at the first character with one shared-zone request on row ${row}`, () => {
        const requests = [];
        const subscription = editor.onDidRequestAutoscroll((request) => requests.push(request));
        try {
          if (route === "line command") lineView.moveToLineNumber(row);
          else listView.openDiff({ newStart: row + 1 });
          expect(editor.getCursorBufferPosition()).toEqual([row, column]);
          expect(requests.length).toBe(1);
          expect(requests[0].options.mode).toEqual([25, 75]);
          expect(requests[0].screenRange.start).toEqual([row, column]);
        } finally {
          subscription.dispose();
        }
      });
    }
  }
});
