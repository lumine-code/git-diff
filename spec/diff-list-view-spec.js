const path = require("path");
const fs = require("@lumine-code/fs-plus");
const temp = require("@lumine-code/temp").track();

describe("git-diff:toggle-diff-list", () => {
  let diffListView, editor;

  beforeEach(async () => {
    const projectPath = temp.mkdirSync("git-diff-spec-");
    fs.copySync(path.join(__dirname, "fixtures", "working-dir"), projectPath);
    fs.moveSync(path.join(projectPath, "git.git"), path.join(projectPath, ".git"));
    lumine.project.setPaths([projectPath]);

    jasmine.attachToDOM(lumine.workspace.getElement());

    await lumine.workspace.open(path.join(projectPath, "sample.js"));
    await lumine.packages.activatePackage("git-diff");

    editor = lumine.workspace.getActiveTextEditor();

    editor.setCursorBufferPosition([8, 30]);
    editor.insertText("a");
    // The list reads the diffs the editor's view computed, so wait for that
    // computation to land before toggling.
    advanceClock(editor.getBuffer().stoppedChangingDelay);
    await conditionPromise(() => editor.getMarkers().length > 0);
    lumine.commands.dispatch(editor.getElement(), "git-diff:toggle-diff-list");

    await conditionPromise(() => {
      diffListView = document.querySelector(".diff-list-view");
      return diffListView && diffListView.querySelectorAll("li").length > 0;
    });
  });

  it("shows a list of all diff hunks", () => {
    diffListView = document.querySelector(".diff-list-view ol");
    expect(diffListView.textContent).toBe("while (items.length > 0) {a-9,1 +9,1");
  });

  it("moves the cursor to the selected hunk", () => {
    editor.setCursorBufferPosition([0, 0]);
    lumine.commands.dispatch(document.querySelector(".diff-list-view"), "core:confirm");
    expect(editor.getCursorBufferPosition()).toEqual([8, 4]);
  });
});
