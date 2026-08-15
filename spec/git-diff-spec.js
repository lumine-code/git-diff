const path = require("path");
const fs = require("@lumine-code/fs-plus");
const temp = require("@lumine-code/temp").track();
const { stopAllWatchers } = require(
  path.join(lumine.application.getResourcePath(), "src", "path-watcher"),
);

describe("GitDiff package", () => {
  let editor, editorElement, projectPath, screenUpdates;

  beforeEach(async () => {
    screenUpdates = 0;
    spyOn(window, "requestAnimationFrame").and.callFake((fn) => {
      fn();
      screenUpdates++;
    });
    spyOn(window, "cancelAnimationFrame").and.callFake((_i) => null);

    projectPath = temp.mkdirSync("git-diff-spec-");
    const otherPath = temp.mkdirSync("some-other-path-");

    fs.copySync(path.join(__dirname, "fixtures", "working-dir"), projectPath);
    fs.moveSync(path.join(projectPath, "git.git"), path.join(projectPath, ".git"));
    lumine.project.setPaths([otherPath, projectPath]);

    jasmine.attachToDOM(lumine.workspace.getElement());

    await lumine.workspace.open(path.join(projectPath, "sample.js"));
    await lumine.packages.activatePackage("git-diff");

    editor = lumine.workspace.getActiveTextEditor();
    editorElement = lumine.views.getView(editor);
  });

  afterEach(async () => {
    await Promise.allSettled(
      lumine.project.getPaths().map((projectPath) => lumine.project.getWatcherPromise(projectPath)),
    );
    await stopAllWatchers();
    temp.cleanup();
  });

  describe("when the editor has no changes", () => {
    it("doesn't mark the editor", async () => {
      await conditionPromise(() => screenUpdates > 0);
      expect(editor.getMarkers().length).toBe(0);
    });
  });

  describe("when a repository event changes none of the diff inputs", () => {
    it("skips recomputing the line diffs", async () => {
      let repository, afterFirstEdit;

      await conditionPromise(() => screenUpdates > 0);
      repository = await lumine.repositories.resolveForPath(path.join(projectPath, "sample.js"));
      // The file's status is one of the inputs a recomputation is skipped on,
      // and it arrives from the git worker. Recording a diff before the snapshot
      // lands leaves the view holding the status of a file git has not described
      // yet, so the next repository event sees an input that genuinely changed
      // and recomputes — correctly, but not what this spec is about.
      await repository.ensureStatusSnapshot();
      expect(repository).toBeTruthy();
      spyOn(repository, "getLineDiffsAsync").and.callThrough();

      editor.insertText("a");
      advanceClock(editor.getBuffer().stoppedChangingDelay);

      // The buffer edit forces a compute that also applies (markers appear).
      await conditionPromise(() => editor.getMarkers().length > 0);
      afterFirstEdit = repository.getLineDiffsAsync.calls.count();

      // An index-only event — staging, unstaging — reuses the same head oid
      // and buffer, so no worker round trip happens.
      repository.emitter.emit("did-change-status-snapshot", repository.getStatusSnapshot());
      expect(repository.getLineDiffsAsync.calls.count()).toBe(afterFirstEdit);

      // Another buffer change still recomputes...
      editor.insertText("b");
      advanceClock(editor.getBuffer().stoppedChangingDelay);

      await conditionPromise(() => repository.getLineDiffsAsync.calls.count() > afterFirstEdit);
      // ...and once it lands, an input-free repository event skips again.
      const afterSecondEdit = repository.getLineDiffsAsync.calls.count();
      repository.emitter.emit("did-change-status-snapshot", repository.getStatusSnapshot());
      expect(repository.getLineDiffsAsync.calls.count()).toBe(afterSecondEdit);
    });
  });

  describe("when the editor has modified lines", () => {
    it("highlights the modified lines", async () => {
      expect(editorElement.querySelectorAll(".git-line-modified").length).toBe(0);
      editor.insertText("a");
      advanceClock(editor.getBuffer().stoppedChangingDelay);

      await conditionPromise(() => editor.getMarkers().length > 0);
      expect(editorElement.querySelectorAll(".git-line-modified").length).toBe(1);
      expect(editorElement.querySelector(".git-line-modified")).toHaveData("buffer-row", 0);
    });
  });

  describe("when the editor has added lines", () => {
    it("highlights the added lines", async () => {
      expect(editorElement.querySelectorAll(".git-line-added").length).toBe(0);
      editor.moveToEndOfLine();
      editor.insertNewline();
      editor.insertText("a");
      advanceClock(editor.getBuffer().stoppedChangingDelay);
      await conditionPromise(() => editor.getMarkers().length > 0);
      expect(editorElement.querySelectorAll(".git-line-added").length).toBe(1);
      expect(editorElement.querySelector(".git-line-added")).toHaveData("buffer-row", 1);
    });
  });

  describe("when the editor has removed lines", () => {
    it("highlights the line preceeding the deleted lines", async () => {
      expect(editorElement.querySelectorAll(".git-line-added").length).toBe(0);
      editor.setCursorBufferPosition([5]);
      editor.deleteLine();
      advanceClock(editor.getBuffer().stoppedChangingDelay);
      await conditionPromise(() => editor.getMarkers().length > 0);
      expect(editorElement.querySelectorAll(".git-line-removed").length).toBe(1);
      expect(editorElement.querySelector(".git-line-removed")).toHaveData("buffer-row", 4);
    });
  });

  describe("when the editor has removed the first line", () => {
    it("highlights the line preceeding the deleted lines", async () => {
      expect(editorElement.querySelectorAll(".git-line-added").length).toBe(0);
      editor.setCursorBufferPosition([0, 0]);
      editor.deleteLine();
      advanceClock(editor.getBuffer().stoppedChangingDelay);
      await conditionPromise(() => editor.getMarkers().length > 0);
      expect(editorElement.querySelectorAll(".git-previous-line-removed").length).toBe(1);
      expect(editorElement.querySelector(".git-previous-line-removed")).toHaveData("buffer-row", 0);
    });
  });

  describe("when a modified line is restored to the HEAD version contents", () => {
    it("removes the diff highlight", async () => {
      expect(editorElement.querySelectorAll(".git-line-modified").length).toBe(0);
      editor.insertText("a");
      advanceClock(editor.getBuffer().stoppedChangingDelay);
      await conditionPromise(() => editorElement.querySelectorAll(".git-line-modified").length > 0);
      expect(editorElement.querySelectorAll(".git-line-modified").length).toBe(1);
      editor.backspace();
      advanceClock(editor.getBuffer().stoppedChangingDelay);

      await conditionPromise(() => editorElement.querySelectorAll(".git-line-modified").length < 1);
      expect(editorElement.querySelectorAll(".git-line-modified").length).toBe(0);
    });
  });

  describe("when a modified file is opened", () => {
    it("highlights the changed lines", async () => {
      fs.writeFileSync(path.join(projectPath, "sample.txt"), "Some different text.");

      await lumine.workspace.open(path.join(projectPath, "sample.txt"));

      editor = lumine.workspace.getActiveTextEditor();
      editorElement = editor.getElement();

      await conditionPromise(() => editor.getMarkers().length > 0);

      expect(editorElement.querySelectorAll(".git-line-modified").length).toBe(1);
      expect(editorElement.querySelector(".git-line-modified")).toHaveData("buffer-row", 0);
    });
  });

  describe("when an ignored file is opened", () => {
    // Git reports "ignored" as its own state, not as "untracked", so the
    // untracked early-out never covered it. The path here also carries a glob
    // metacharacter, which `git show <rev>:<path>` used to answer with HEAD's
    // commit message at exit 0 rather than reporting the path as absent —
    // between them, every line of an ignored file showed as changed.
    it("leaves the editor unmarked", async () => {
      let repository, ignoredEditor;
      const ignoredPath = path.join(projectPath, "[e] dir", "out.log");

      fs.writeFileSync(path.join(projectPath, ".gitignore"), "*.log\n");
      fs.mkdirSync(path.join(projectPath, "[e] dir"));
      fs.writeFileSync(ignoredPath, "one\ntwo\nthree\n");

      repository = await lumine.repositories.resolveForPath(ignoredPath);
      await repository.refreshStatusSnapshot();
      ignoredEditor = await lumine.workspace.open(ignoredPath);

      expect(repository.getStatusEntry(ignoredPath).ignored).toBe(true);
      // Absent at HEAD however the path is spelled.
      expect(await repository.getFileAtRevision(ignoredPath, "HEAD")).toBeNull();

      spyOn(repository, "getLineDiffsAsync").and.callThrough();
      ignoredEditor.insertText("a");
      advanceClock(ignoredEditor.getBuffer().stoppedChangingDelay);
      expect(repository.getLineDiffsAsync).not.toHaveBeenCalled();
      expect(ignoredEditor.getMarkers().length).toBe(0);
    });
  });

  describe("when the project paths change", () => {
    it("doesn't try to use the destroyed git repository", async () => {
      editor.deleteLine();
      lumine.project.setPaths([temp.mkdirSync("no-repository")]);
      advanceClock(editor.getBuffer().stoppedChangingDelay);
      await conditionPromise(() => editor.getMarkers().length === 0);
      expect(editor.getMarkers().length).toBe(0);
    });
  });

  describe("move-to-next-diff/move-to-previous-diff events", () => {
    it("moves the cursor to first character of the next/previous diff line", async () => {
      editor.insertText("a");
      editor.setCursorBufferPosition([5]);
      editor.deleteLine();
      advanceClock(editor.getBuffer().stoppedChangingDelay);

      // The diff is computed off-thread by the git-host worker now, so wait for
      // the deletion marker before exercising the navigation commands.
      await conditionPromise(() => editorElement.querySelectorAll(".git-line-removed").length > 0);
      editor.setCursorBufferPosition([0]);
      lumine.commands.dispatch(editorElement, "git-diff:move-to-next-diff");
      expect(editor.getCursorBufferPosition()).toEqual([4, 4]);

      lumine.commands.dispatch(editorElement, "git-diff:move-to-previous-diff");
      expect(editor.getCursorBufferPosition()).toEqual([0, 0]);
    });

    it("wraps around to the first/last diff in the file", async () => {
      editor.insertText("a");
      editor.setCursorBufferPosition([5]);
      editor.deleteLine();
      advanceClock(editor.getBuffer().stoppedChangingDelay);

      await conditionPromise(() => editorElement.querySelectorAll(".git-line-removed").length > 0);
      editor.setCursorBufferPosition([0]);
      lumine.commands.dispatch(editorElement, "git-diff:move-to-next-diff");
      expect(editor.getCursorBufferPosition().toArray()).toEqual([4, 4]);

      lumine.commands.dispatch(editorElement, "git-diff:move-to-next-diff");
      expect(editor.getCursorBufferPosition().toArray()).toEqual([0, 0]);

      lumine.commands.dispatch(editorElement, "git-diff:move-to-previous-diff");
      expect(editor.getCursorBufferPosition().toArray()).toEqual([4, 4]);
    });

    describe("when the wrapAroundOnMoveToDiff config option is false", () => {
      beforeEach(() => lumine.config.set("git-diff.wrapAroundOnMoveToDiff", false));

      it("does not wraps around to the first/last diff in the file", async () => {
        editor.insertText("a");
        editor.setCursorBufferPosition([5]);
        editor.deleteLine();
        advanceClock(editor.getBuffer().stoppedChangingDelay);
        await conditionPromise(
          () => editorElement.querySelectorAll(".git-line-removed").length > 0,
        );

        editor.setCursorBufferPosition([0]);
        lumine.commands.dispatch(editorElement, "git-diff:move-to-next-diff");
        expect(editor.getCursorBufferPosition()).toEqual([4, 4]);

        lumine.commands.dispatch(editorElement, "git-diff:move-to-next-diff");
        expect(editor.getCursorBufferPosition()).toEqual([4, 4]);

        lumine.commands.dispatch(editorElement, "git-diff:move-to-previous-diff");
        expect(editor.getCursorBufferPosition()).toEqual([0, 0]);

        lumine.commands.dispatch(editorElement, "git-diff:move-to-previous-diff");
        expect(editor.getCursorBufferPosition()).toEqual([0, 0]);
      });
    });
  });

  describe("when the showIconsInEditorGutter config option is true", () => {
    beforeEach(() => {
      lumine.config.set("git-diff.showIconsInEditorGutter", true);
    });

    it("the gutter has a git-diff-icon class", async () => {
      await conditionPromise(() => screenUpdates > 0);
      expect(editorElement.querySelector(".gutter")).toHaveClass("git-diff-icon");
    });

    it("keeps the git-diff-icon class when editor.showLineNumbers is toggled", async () => {
      await conditionPromise(() => screenUpdates > 0);

      lumine.config.set("editor.showLineNumbers", false);
      expect(editorElement.querySelector(".gutter")).not.toHaveClass("git-diff-icon");

      lumine.config.set("editor.showLineNumbers", true);
      expect(editorElement.querySelector(".gutter")).toHaveClass("git-diff-icon");
    });

    it("removes the git-diff-icon class when the showIconsInEditorGutter config option set to false", async () => {
      await conditionPromise(() => screenUpdates > 0);

      lumine.config.set("git-diff.showIconsInEditorGutter", false);
      expect(editorElement.querySelector(".gutter")).not.toHaveClass("git-diff-icon");
    });
  });
});
