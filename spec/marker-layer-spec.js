const { CompositeDisposable } = require("lumine");
const path = require("path");
const fs = require("@lumine-code/fs-plus");
const temp = require("@lumine-code/temp").track();

describe("git-diff marker layer", () => {
  let workspaceElement, mainModule, provider, projectPath, editor, layers;

  // The spec runner freezes setTimeout, so poll on animation frames instead.
  function waitFor(condition, { frames = 600 } = {}) {
    return new Promise((resolve, reject) => {
      let count = 0;
      const check = () => {
        let value;
        try {
          value = condition();
        } catch {
          value = null;
        }
        if (value) {
          resolve(value);
        } else if (++count > frames) {
          reject(new Error("Timed out waiting for condition"));
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  }

  function createLayer(layerEditor) {
    const layer = {
      editor: layerEditor,
      props: provider,
      cache: new Map(),
      items: [],
      disposables: new CompositeDisposable(),
      update: jasmine.createSpy("update"),
    };
    layers.push(layer);
    return layer;
  }

  // Attached the way a renderer's layer host attaches it, then waited out
  // until the editor's GitDiffView applied its first computation. `repo:
  // false` skips that wait — a repository-less view keeps `diffs` null
  // forever, which is indistinguishable from one still resolving.
  async function createInitializedLayer(layerEditor, { repo = true } = {}) {
    const layer = createLayer(layerEditor);
    provider.initialize(layer);
    if (repo) {
      await waitFor(() => mainModule.markerLayer.views.get(layerEditor)?.diffs);
    } else {
      await waitFor(() => mainModule.markerLayer.views.get(layerEditor));
    }
    return layer;
  }

  async function refresh(...targets) {
    for (const layer of targets) {
      layer.update.calls.reset();
    }
    const view = mainModule.markerLayer.views.get(targets[0].editor);
    // The memo-skip would swallow the spec's synchronous edits: the frozen
    // clock never fires onDidStopChanging, so flag the buffer by hand.
    view.bufferChangedSinceDiff = true;
    await view.updateDiffs();
    await waitFor(() => targets.every((layer) => layer.update.calls.count() > 0));
  }

  beforeEach(async () => {
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);
    layers = [];

    projectPath = temp.mkdirSync("git-diff-marker-");
    fs.copySync(path.join(__dirname, "fixtures", "working-dir"), projectPath);
    fs.moveSync(path.join(projectPath, "git.git"), path.join(projectPath, ".git"));

    editor = await lumine.workspace.open(path.join(projectPath, "sample.js"));
    const pack = await lumine.packages.activatePackage("git-diff");
    mainModule = pack.mainModule;
    provider = mainModule.provideMarkerLayer();
  });

  afterEach(() => {
    for (const layer of layers) {
      layer.disposables.dispose();
    }
    try {
      temp.cleanup();
    } catch {
      // Windows can refuse to delete a repository the git host still holds
      // open; the OS cleans the temp directory eventually.
    }
  });

  describe("marker.layer service provider", () => {
    it("describes the git-diff layer", () => {
      expect(provider.name).toBe("git-diff");
      expect(provider.position).toBe("right");
      expect(provider.merge).toBe(true);
      expect(provider.enabled).toBe("git-diff.marker.enabled");
      expect(provider.threshold).toBe("git-diff.marker.threshold");
      expect(typeof provider.initialize).toBe("function");
      expect(typeof provider.getItems).toBe("function");
    });

    it("shares the diff view that owns the editor's repository", async () => {
      const layer = await createInitializedLayer(editor);
      const { repository } = mainModule.markerLayer.views.get(layer.editor);
      expect(repository).toBeTruthy();
      // Normalize separators, 8.3 aliases, and drive-letter case on Windows.
      const normalize = (p) =>
        require("fs").realpathSync.native(p).replace(/\\/g, "/").toLowerCase();
      expect(normalize(repository.getWorkingDirectory())).toBe(normalize(projectPath));
    });

    it("reports no markers for editors outside any repository", async () => {
      const outsidePath = temp.mkdirSync("git-diff-marker-out-");
      const outsideEditor = await lumine.workspace.open(path.join(outsidePath, "plain.txt"));

      const layer = await createInitializedLayer(outsideEditor, { repo: false });
      expect(mainModule.markerLayer.views.get(outsideEditor).repository).toBe(null);
      expect(provider.getItems(layer)).toEqual([]);
    });

    it("reports no markers for an unmodified file", async () => {
      const layer = await createInitializedLayer(editor);
      await refresh(layer);
      expect(layer.cache.get("diffs")).toEqual([]);
      expect(provider.getItems(layer)).toEqual([]);
    });

    it("marks modified lines", async () => {
      const layer = await createInitializedLayer(editor);

      editor.setTextInBufferRange(
        [
          [0, 0],
          [0, 1],
        ],
        "M",
      );
      await refresh(layer);

      expect(provider.getItems(layer)).toEqual([{ row: 0, end: 0, cls: "modified" }]);
    });

    it("marks added lines", async () => {
      const layer = await createInitializedLayer(editor);

      editor.setCursorBufferPosition([0, Infinity]);
      editor.insertNewline();
      editor.insertText("added-one");
      editor.insertNewline();
      editor.insertText("added-two");
      await refresh(layer);

      expect(provider.getItems(layer)).toEqual([{ row: 1, end: 2, cls: "added" }]);
    });

    it("marks the line preceding removed lines", async () => {
      const layer = await createInitializedLayer(editor);

      editor.setSelectedBufferRange([
        [1, 0],
        [2, 0],
      ]);
      editor.delete();
      await refresh(layer);

      expect(provider.getItems(layer)).toEqual([{ row: 0, end: 0, cls: "removed" }]);
    });

    // Git reports "ignored" as its own state, not as "untracked", so the
    // untracked early-out never covered it. The path here also carries a glob
    // metacharacter, which `git show <rev>:<path>` used to answer with HEAD's
    // commit message rather than reporting the path as absent — between them,
    // every line of an ignored file was marked.
    it("reports no markers for an ignored file", async () => {
      const ignoredPath = path.join(projectPath, "[e] dir", "out.log");
      fs.writeFileSync(path.join(projectPath, ".gitignore"), "*.log\n");
      fs.makeTreeSync(path.join(projectPath, "[e] dir"));
      fs.writeFileSync(ignoredPath, "one\ntwo\nthree\n");

      const repository = await lumine.repositories.resolveForPath(ignoredPath);
      await repository.refreshStatusSnapshot();
      expect(repository.getStatusEntry(ignoredPath).ignored).toBe(true);
      expect(await repository.getFileAtRevision(ignoredPath, "HEAD")).toBeNull();

      const ignoredEditor = await lumine.workspace.open(ignoredPath);
      const layer = await createInitializedLayer(ignoredEditor);
      spyOn(repository, "getLineDiffsAsync").and.callThrough();
      ignoredEditor.setCursorBufferPosition([0, Infinity]);
      ignoredEditor.insertText("edited");
      await refresh(layer);

      expect(repository.getLineDiffsAsync).not.toHaveBeenCalled();
      expect(layer.cache.get("diffs")).toEqual([]);
      expect(provider.getItems(layer)).toEqual([]);
    });

    it("returns raw hunk ranges and leaves merging to the host", () => {
      const layer = createLayer(editor);
      layer.cache.set("diffs", [
        { newStart: 4, oldLines: 0, newLines: 2 },
        { newStart: 1, oldLines: 0, newLines: 3 },
        { newStart: 10, oldLines: 1, newLines: 1 },
      ]);

      expect(provider.getItems(layer)).toEqual([
        { row: 3, end: 4, cls: "added" },
        { row: 0, end: 2, cls: "added" },
        { row: 9, end: 9, cls: "modified" },
      ]);
    });
  });

  describe("the view handover", () => {
    it("forgets the editor once its layer detaches", async () => {
      const layer = await createInitializedLayer(editor);
      expect(mainModule.markerLayer.layers.has(editor)).toBe(true);

      layer.disposables.dispose();
      expect(mainModule.markerLayer.layers.has(editor)).toBe(false);
      // The view itself belongs to the gutter and stays.
      expect(mainModule.markerLayer.views.get(editor)).toBeDefined();
    });
  });
});
