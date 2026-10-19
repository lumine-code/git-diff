const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const temp = require("@lumine-code/fs-temp").track();
const captureFixture = require("./fixture");

describe("Git Diff staged and unstaged changes", () => {
  let cleanup, projectPath, editor, element, view, repository, baseline;

  // Use real Git index mutations without blocking the renderer or rewriting
  // the open file when a test needs to change only its staged contents.
  function git(args, input) {
    return new Promise((resolve, reject) => {
      const child = execFile(
        lumine.config.get("git.path") || "git",
        ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args],
        { cwd: projectPath, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) reject(new Error(`${args.join(" ")}: ${stderr || error.message}`));
          else resolve(stdout);
        },
      );
      if (input !== undefined) child.stdin.end(input);
    });
  }

  function text(lines) {
    return `${lines.join("\n")}\n`;
  }

  async function setLines(lines, { save = false } = {}) {
    editor.setText(text(lines));
    if (save) await editor.save();
    await view.updateDiffs();
  }

  function summaries() {
    return view.diffs
      ?.map(({ stage, newStart, oldLines, newLines }) => ({
        stage,
        newStart,
        oldLines,
        newLines,
      }))
      .sort((left, right) => left.newStart - right.newStart);
  }

  async function waitForDiffs(expected) {
    try {
      await conditionPromise(() => JSON.stringify(summaries()) === JSON.stringify(expected));
    } catch (error) {
      throw new Error(`${error.message}; actual diffs: ${JSON.stringify(summaries())}`, {
        cause: error,
      });
    }
    expect(summaries()).toEqual(expected);
  }

  async function stage() {
    await git(["add", "--", "sample.txt"]);
    // The view must refresh from the repository event. A forced update here
    // would conceal a missing index input in the snapshot or its memo key.
    await repository.refreshStatusSnapshot();
  }

  function expectStagedOverviewColor(kind, color) {
    const provider = lumine.packages.getActivePackage("git-diff").mainModule.provideMarkerLayer();
    const overview = provider.getItems({ editor });
    expect(overview.length).toBe(1);
    expect(overview[0].cls).toBe(`${kind} staged`);
    const marker = document.createElement("div");
    marker.className = `marker marker-git-diff ${overview[0].cls}`;
    marker.style.setProperty(`--syntax-color-${kind}-staged`, color);
    lumine.workspace.getElement().appendChild(marker);
    try {
      expect(getComputedStyle(marker).backgroundColor).toBe(color);
    } finally {
      marker.remove();
    }
  }

  function expectNoMarkers() {
    expect(view.markers.size).toBe(0);
    expect(
      element.querySelectorAll(
        ".git-line-added,.git-line-modified,.git-line-removed,.git-previous-line-removed",
      ).length,
    ).toBe(0);
    const provider = lumine.packages.getActivePackage("git-diff").mainModule.provideMarkerLayer();
    expect(provider.getItems({ editor })).toEqual([]);
    expect(lumine.commands.canDispatch(element, "git-diff:toggle-diff-list")).toBe(false);
  }

  beforeEach(async () => {
    cleanup = captureFixture();
    projectPath = temp.mkdirSync("git-diff-staging-");
    baseline = Array.from({ length: 20 }, (_, index) => `original line ${index + 1}`);
    await git(["init", "--initial-branch=master"]);
    await fs.promises.writeFile(path.join(projectPath, "sample.txt"), text(baseline));
    await git(["add", "--", "sample.txt"]);
    await git([
      "-c",
      "user.name=Git Diff Fixture",
      "-c",
      "user.email=git-diff-fixture@example.invalid",
      "commit",
      "-m",
      "Initial fixture",
    ]);

    lumine.project.setPaths([projectPath]);
    lumine.config.set("git-diff.showIconsInEditorGutter", false);
    jasmine.attachToDOM(lumine.workspace.getElement());
    editor = await lumine.workspace.open(path.join(projectPath, "sample.txt"));
    element = lumine.views.getView(editor);
    const pack = await lumine.packages.activatePackage("git-diff");
    view = pack.mainModule.markerLayer.views.get(editor);
    await conditionPromise(() => view.repository && view.diffs != null);
    repository = view.repository;
    await repository.ensureStatusSnapshot();
    await view.updateDiffs();
    await waitForDiffs([]);
  });

  afterEach(async () => {
    await cleanup(projectPath);
    await temp.cleanup();
  });

  it("recolors existing gutter markers after staging and unstaging without a buffer edit", async () => {
    const primaryColor = "rgb(11, 22, 33)";
    const secondaryColor = "rgb(44, 55, 66)";
    element.style.setProperty("--syntax-color-modified", primaryColor);
    element.style.setProperty("--syntax-color-modified-staged", secondaryColor);
    const lines = [...baseline];
    lines[4] = "modified line";
    await setLines(lines, { save: true });
    await waitForDiffs([{ stage: "unstaged", newStart: 5, oldLines: 1, newLines: 1 }]);
    await conditionPromise(() => element.querySelector(".git-line-modified"));
    expect(element.querySelector(".git-line-modified")).not.toHaveClass("git-line-staged");
    expect(getComputedStyle(element.querySelector(".git-line-modified")).color).toBe(primaryColor);

    await stage();
    await waitForDiffs([{ stage: "staged", newStart: 5, oldLines: 1, newLines: 1 }]);
    await conditionPromise(() => element.querySelector(".git-line-modified.git-line-staged"));
    expect(getComputedStyle(element.querySelector(".git-line-modified")).color).toBe(
      secondaryColor,
    );
    expectStagedOverviewColor("modified", secondaryColor);
    lumine.config.set("git-diff.showIconsInEditorGutter", true);
    expect(getComputedStyle(element.querySelector(".git-line-modified"), "::before").color).toBe(
      secondaryColor,
    );

    await git(["reset", "HEAD", "--", "sample.txt"]);
    await repository.refreshStatusSnapshot();
    await waitForDiffs([{ stage: "unstaged", newStart: 5, oldLines: 1, newLines: 1 }]);
    await conditionPromise(() => !element.querySelector(".git-line-staged"));
    expect(getComputedStyle(element.querySelector(".git-line-modified"), "::before").color).toBe(
      primaryColor,
    );
    expect(editor.getText()).toBe(text(lines));
  });

  it("places disjoint staged changes in current buffer coordinates after an unsaved insertion", async () => {
    const staged = [...baseline];
    staged[14] = "staged line";
    await setLines(staged, { save: true });
    await stage();
    await waitForDiffs([{ stage: "staged", newStart: 15, oldLines: 1, newLines: 1 }]);

    const current = [...staged];
    current.splice(1, 0, "unsaved inserted line");
    await setLines(current);
    await waitForDiffs([
      { stage: "unstaged", newStart: 2, oldLines: 0, newLines: 1 },
      { stage: "staged", newStart: 16, oldLines: 1, newLines: 1 },
    ]);
    // The editor renders only visible gutter rows. Reveal the shifted staged
    // line before inspecting its rendered buffer coordinates.
    editor.scrollToBufferPosition([15, 0]);
    await conditionPromise(() => element.querySelector(".git-line-modified.git-line-staged"));
    expect(element.querySelector(".git-line-modified.git-line-staged")).toHaveData(
      "buffer-row",
      15,
    );
    expect(editor.getFileState()).toBe("modified");
  });

  it("gives unstaged changes priority when the same line has both states", async () => {
    const staged = [...baseline];
    staged[4] = "staged replacement";
    await setLines(staged, { save: true });
    await stage();
    await waitForDiffs([{ stage: "staged", newStart: 5, oldLines: 1, newLines: 1 }]);

    const current = [...staged];
    current[4] = "unsaved replacement";
    await setLines(current);
    await waitForDiffs([{ stage: "unstaged", newStart: 5, oldLines: 1, newLines: 1 }]);
    await conditionPromise(() => !element.querySelector(".git-line-staged"));
    expect(repository.getStatusEntry(editor.getPath()).staged).toBe(true);
  });

  for (const [name, transform, expected, selector] of [
    [
      "addition",
      (lines) => lines.splice(4, 0, "staged inserted line"),
      { stage: "staged", newStart: 5, oldLines: 0, newLines: 1 },
      ".git-line-added.git-line-staged",
    ],
    [
      "deletion",
      (lines) => lines.splice(4, 1),
      { stage: "staged", newStart: 4, oldLines: 1, newLines: 0 },
      ".git-line-removed.git-line-staged",
    ],
    [
      "first-line deletion",
      (lines) => lines.splice(0, 1),
      { stage: "staged", newStart: 0, oldLines: 1, newLines: 0 },
      ".git-previous-line-removed.git-line-staged",
    ],
  ]) {
    it(`preserves the change kind and staged color for a staged ${name}`, async () => {
      const kind = selector.includes("added") ? "added" : "removed";
      const secondaryColor = "rgb(44, 55, 66)";
      element.style.setProperty(`--syntax-color-${kind}-staged`, secondaryColor);
      const lines = [...baseline];
      transform(lines);
      await setLines(lines, { save: true });
      await stage();
      await waitForDiffs([expected]);
      await conditionPromise(() => element.querySelector(selector));
      expect(element.querySelectorAll(selector).length).toBe(1);
      const marker = element.querySelector(selector);
      const renderedColor =
        kind === "removed"
          ? getComputedStyle(marker, "::before").borderLeftColor
          : getComputedStyle(marker).color;
      expect(renderedColor).toBe(secondaryColor);
      lumine.config.set("git-diff.showIconsInEditorGutter", true);
      expect(getComputedStyle(marker, "::before").color).toBe(secondaryColor);

      expectStagedOverviewColor(kind, secondaryColor);
    });
  }

  it("keeps a new file free of markers before staging, after staging, and after unstaging", async () => {
    const newPath = path.join(projectPath, "new.txt");
    await fs.promises.writeFile(newPath, "first\nsecond\n");
    await repository.refreshStatusSnapshot();
    editor = await lumine.workspace.open(newPath);
    element = lumine.views.getView(editor);
    view = lumine.packages.getActivePackage("git-diff").mainModule.markerLayer.views.get(editor);
    await conditionPromise(() => view.repository && view.diffs != null);
    await waitForDiffs([]);
    expectNoMarkers();

    await git(["add", "--", "new.txt"]);
    await repository.refreshStatusSnapshot();
    await view.updateDiffs();
    await waitForDiffs([]);
    expectNoMarkers();

    await git(["reset", "HEAD", "--", "new.txt"]);
    await repository.refreshStatusSnapshot();
    await view.updateDiffs();
    await waitForDiffs([]);
    expectNoMarkers();
  });

  it("omits whole-file additions before the repository has its first commit", async () => {
    await git(["checkout", "--orphan", "unborn"]);
    await repository.refreshStatusSnapshot();
    expect(repository.getStatusSnapshot().head.unborn).toBe(true);
    await view.updateDiffs();
    await waitForDiffs([]);
    expectNoMarkers();

    const lines = [...baseline];
    lines[4] = "first unstaged edit";
    await setLines(lines, { save: true });
    await waitForDiffs([{ stage: "unstaged", newStart: 5, oldLines: 1, newLines: 1 }]);
    await stage();
    await waitForDiffs([]);
    await conditionPromise(() => !element.querySelector(".git-line-modified"));
    expectNoMarkers();

    await git([
      "-c",
      "user.name=Git Diff Fixture",
      "-c",
      "user.email=git-diff-fixture@example.invalid",
      "commit",
      "-m",
      "First orphan commit",
    ]);
    await repository.refreshStatusSnapshot();
    lines[4] = "edit after the first commit";
    await setLines(lines, { save: true });
    await stage();
    await waitForDiffs([{ stage: "staged", newStart: 5, oldLines: 1, newLines: 1 }]);
  });

  it("omits whole-file additions for intent-to-add entries with no baseline blob", async () => {
    const newPath = path.join(projectPath, "intent.txt");
    await fs.promises.writeFile(newPath, "first\nsecond\n");
    await git(["add", "-N", "--", "intent.txt"]);
    await repository.refreshStatusSnapshot();
    editor = await lumine.workspace.open(newPath);
    element = lumine.views.getView(editor);
    view = lumine.packages.getActivePackage("git-diff").mainModule.markerLayer.views.get(editor);
    await conditionPromise(() => view.repository && view.diffs != null);
    expect(repository.getStatusEntry(newPath).indexBlobOid).toBeNull();
    await waitForDiffs([]);
    expectNoMarkers();

    editor.insertText("unsaved ");
    await view.updateDiffs();
    await waitForDiffs([]);
    expectNoMarkers();
  });

  it("does not mark a new buffer whose assigned path has never been saved", async () => {
    const newPath = path.join(projectPath, "never-saved.txt");
    editor = await lumine.workspace.open(newPath);
    element = lumine.views.getView(editor);
    view = lumine.packages.getActivePackage("git-diff").mainModule.markerLayer.views.get(editor);
    await conditionPromise(() => view.repository && view.diffs != null);
    expect(repository.getStatusEntry(newPath)).toBeNull();
    editor.insertText("first\nsecond\n");
    await view.updateDiffs();
    await waitForDiffs([]);
    expectNoMarkers();

    await editor.save();
    await git(["add", "--", "never-saved.txt"]);
    await repository.refreshStatusSnapshot();
    await view.updateDiffs();
    await waitForDiffs([]);
    expectNoMarkers();

    editor.setText("first\nchanged second\n");
    await view.updateDiffs();
    await waitForDiffs([{ stage: "unstaged", newStart: 2, oldLines: 1, newLines: 1 }]);
  });

  it("still shows individual unstaged edits made after staging a new file", async () => {
    const newPath = path.join(projectPath, "new.txt");
    await fs.promises.writeFile(newPath, text(baseline));
    await git(["add", "--", "new.txt"]);
    await repository.refreshStatusSnapshot();
    editor = await lumine.workspace.open(newPath);
    element = lumine.views.getView(editor);
    view = lumine.packages.getActivePackage("git-diff").mainModule.markerLayer.views.get(editor);
    await conditionPromise(() => view.repository && view.diffs != null);
    const lines = [...baseline];
    lines[4] = "unsaved replacement";
    await setLines(lines);
    await waitForDiffs([{ stage: "unstaged", newStart: 5, oldLines: 1, newLines: 1 }]);
    await conditionPromise(() => element.querySelector(".git-line-modified"));
    expect(element.querySelector(".git-line-staged")).toBeNull();

    await editor.save();
    await git(["add", "--", "new.txt"]);
    await repository.refreshStatusSnapshot();
    await waitForDiffs([]);
    await conditionPromise(() => !element.querySelector(".git-line-modified"));
    expectNoMarkers();
  });

  it("keeps additions to an empty committed file visible", async () => {
    editor.setText("");
    await editor.save();
    await stage();
    await git([
      "-c",
      "user.name=Git Diff Fixture",
      "-c",
      "user.email=git-diff-fixture@example.invalid",
      "commit",
      "-m",
      "Empty fixture",
    ]);
    await repository.refreshStatusSnapshot();
    await setLines(["new line"], { save: true });
    await stage();
    await waitForDiffs([{ stage: "staged", newStart: 1, oldLines: 0, newLines: 1 }]);
  });

  it("does not mark a surviving buffer as a whole-file addition after staging its deletion", async () => {
    await git(["rm", "--", "sample.txt"]);
    await repository.refreshStatusSnapshot();
    expect(repository.getStatusEntry(editor.getPath()).indexBlobOid).toBeNull();
    expect(editor.getText()).toBe(text(baseline));
    await view.updateDiffs();
    await waitForDiffs([]);
    expectNoMarkers();

    editor.insertText("unsaved after deletion ");
    await view.updateDiffs();
    await waitForDiffs([]);
    expectNoMarkers();
  });

  it("compares a staged rename with the original path in HEAD", async () => {
    await git(["mv", "sample.txt", "renamed.txt"]);
    const renamedPath = path.join(projectPath, "renamed.txt");
    editor.getBuffer().setPath(renamedPath);
    await conditionPromise(() => view.repository && view.editorPath === renamedPath);
    const lines = [...baseline];
    lines[4] = "staged renamed line";
    await setLines(lines, { save: true });
    await git(["add", "--", "renamed.txt"]);
    await repository.refreshStatusSnapshot();
    expect(repository.getStatusEntry(renamedPath).originalPath).toBe("sample.txt");
    await waitForDiffs([{ stage: "staged", newStart: 5, oldLines: 1, newLines: 1 }]);
  });

  it("refreshes when the index blob changes but the file stays MM and the buffer stays unchanged", async () => {
    const staged = [...baseline];
    staged[2] = "first staged value";
    await setLines(staged, { save: true });
    await stage();
    const current = [...staged];
    current[15] = "unstaged value";
    await setLines(current, { save: true });
    await repository.refreshStatusSnapshot();
    await waitForDiffs([
      { stage: "staged", newStart: 3, oldLines: 1, newLines: 1 },
      { stage: "unstaged", newStart: 16, oldLines: 1, newLines: 1 },
    ]);
    const before = repository.getStatusEntry(editor.getPath());
    expect(before.indexStatus).toBe("M");
    expect(before.worktreeStatus).toBe("M");

    const replacementIndex = [...staged];
    replacementIndex[2] = "second staged value";
    const oid = (await git(["hash-object", "-w", "--stdin"], text(replacementIndex))).trim();
    await git(["update-index", "--cacheinfo", `100644,${oid},sample.txt`]);
    await repository.refreshStatusSnapshot();
    const after = repository.getStatusEntry(editor.getPath());
    expect(after.indexStatus).toBe("M");
    expect(after.worktreeStatus).toBe("M");
    await waitForDiffs([
      { stage: "unstaged", newStart: 3, oldLines: 1, newLines: 1 },
      { stage: "unstaged", newStart: 16, oldLines: 1, newLines: 1 },
    ]);
    expect(editor.getText()).toBe(text(current));
  });
});
