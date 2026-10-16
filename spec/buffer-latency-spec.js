const fs = require("@lumine-code/fs-plus");
const path = require("path");
const os = require("os");
const captureFixture = require("./fixture");

describe("git-diff updates during editing", () => {
  let editor, view, projectPath, cleanup;

  beforeEach(async () => {
    cleanup = captureFixture();
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "git-diff-latency-"));
    fs.copySync(path.join(__dirname, "fixtures", "working-dir"), projectPath);
    fs.moveSync(path.join(projectPath, "git.git"), path.join(projectPath, ".git"));
    await lumine.project.setPaths([projectPath]);
    jasmine.attachToDOM(lumine.workspace.getElement());
    editor = await lumine.workspace.open(path.join(projectPath, "sample.js"));
    const main = (await lumine.packages.activatePackage("git-diff")).mainModule;
    view = main.markerLayer.views.get(editor);
    await conditionPromise(() => view.lastDiffInputs != null);
  });

  afterEach(async () => {
    await cleanup(projectPath);
    fs.rmSync(projectPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("updates an edit and undo without advancing the stopped-changing timer", async () => {
    const stopped = jasmine.createSpy("stopped");
    const subscription = editor.onDidStopChanging(stopped);
    try {
      editor.insertText("changed ");
      await conditionPromise(() => view.diffs.length > 0);
      expect(editor.getMarkers().length).toBeGreaterThan(0);
      expect(stopped).not.toHaveBeenCalled();
      editor.undo();
      await conditionPromise(() => view.diffs.length === 0);
      expect(editor.getMarkers().length).toBe(0);
      expect(stopped).not.toHaveBeenCalled();
    } finally {
      subscription.dispose();
    }
  });

  it("compares the final transaction text once rather than every intermediate edit", async () => {
    spyOn(view.repository, "getLineDiffsAsync").and.callThrough();
    editor.transact(() => {
      editor.insertText("one");
      editor.insertText("two");
      editor.insertText("three");
    });
    expect(view.repository.getLineDiffsAsync).not.toHaveBeenCalled();
    await conditionPromise(() => view.diffs.length > 0);
    expect(view.repository.getLineDiffsAsync).toHaveBeenCalledTimes(1);
    expect(view.repository.getLineDiffsAsync.calls.mostRecent().args[1]).toBe(editor.getText());
  });

  it("does not wait for a typing pause between successive edits", async () => {
    const stopped = jasmine.createSpy("stopped");
    const subscription = editor.onDidStopChanging(stopped);
    const updated = jasmine.createSpy("updated");
    const diffsSubscription = view.onDidUpdateDiffs(updated);
    try {
      for (let index = 0; index < 4; index++) {
        const previousCount = updated.calls.count();
        editor.insertText("x");
        await conditionPromise(() => updated.calls.count() > previousCount);
        expect(stopped).not.toHaveBeenCalled();
      }
    } finally {
      subscription.dispose();
      diffsSubscription.dispose();
    }
  });

  it("cancels a queued comparison when the view is destroyed", async () => {
    spyOn(view.repository, "getLineDiffsAsync").and.callThrough();
    const repository = view.repository;
    editor.insertText("changed ");
    view.destroy();
    await flushMicrotasks();
    expect(repository.getLineDiffsAsync).not.toHaveBeenCalled();
  });
});
