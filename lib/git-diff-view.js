const { CompositeDisposable, Emitter } = require("lumine");
const bufferDiffWork = require("./buffer-diff-work");

const MAX_BUFFER_LENGTH_TO_DIFF = 2 * 1024 * 1024;

/**
 * @describe Handles per-editor event and repository subscriptions.
 * @param editor {TextEditor} - The editor this view will manage.
 */
module.exports = class GitDiffView {
  constructor(editor, editorElement) {
    // These are the only members guaranteed to exist.
    this.subscriptions = new CompositeDisposable();
    this.emitter = new Emitter();
    this.editor = editor;
    this.editorElement = editorElement;
    this.repository = null;
    this.diffUpdateGeneration = 0;
    this.destroyed = false;
    this.markers = new Map();

    // Assign `null` to all possible child vars here so the JS engine doesn't
    // have to re-evaluate the microcode when we do eventually need them.
    this.releaseChildren();

    // I know this looks janky but it works. Class methods are available
    // before the constructor is executed. It's a micro-opt above lambdas.
    // WARNING: This gets handed to requestAnimationFrame, so it must be bound.
    this.updateDiffs = this.updateDiffs.bind(this);

    this.subscriptions.add(
      editorElement.onDidDetach(() => this.cancelScheduledUpdate()),
      editorElement.onDidAttach(() => this.scheduleUpdate()),
      lumine.repositories.observeForPath(
        () => this.editor.getPath(),
        (repository, state) => this.bindRepository(repository, state),
        {
          onDidChangePath: (callback) => this.editor.onDidChangePath(callback),
          snapshots: "status",
        },
      ),
      this.editor.onDidChangeGrammar(() => {
        this.updateIconDecoration();
        this.scheduleUpdate();
      }),
    );
  }

  /**
   * @describe Handles tear down of destructables and subscriptions.
   *   Does not handle release of memory. This method should only be called
   *   just before this object is freed, and should only tear down the main
   *   object components that are guarunteed to exist at all times.
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.diffUpdateGeneration++;
    this.subscriptions.dispose();
    this.destroyChildren();
    // Also drops `this.diffs`, so nothing reads stale hunks off a dead view.
    this.releaseChildren();
    this.markers.clear();
    this.emitter.dispose();
  }

  // Fires with the current line diffs after every applied recomputation, and
  // with an empty array when the editor leaves every repository. A consumer
  // arriving between emissions seeds from `this.diffs` instead.
  onDidUpdateDiffs(callback) {
    return this.emitter.on("did-update-diffs", callback);
  }

  /**
   * @describe Destroys this objects children (non-freeing), it's intended
   *   to be an ease-of use function for maintaing this object. This method
   *   should only tear down objects that are selectively allocated upon
   *   repository discovery.
   *
   *   Example: this.diffs only exists when we have a repository.
   */
  destroyChildren() {
    this.cancelScheduledUpdate();
    this.cancelDiffRequest();
    this.diffWork?.dispose();
    this.diffWork = null;

    // `markRange` returns undefined once the buffer is destroyed, so a diff
    // can be in the map with no marker to destroy.
    if (this.diffs) for (const diff of this.diffs) this.markers.get(diff)?.destroy();
  }

  cancelDiffRequest() {
    const controller = this.diffAbortController;
    this.diffAbortController = null;
    controller?.abort();
  }

  clearAppliedDiffs() {
    const hadDiffs = this.diffs?.length > 0 || this.markers.size > 0;
    if (this.diffs) for (const diff of this.diffs) this.markers.get(diff)?.destroy();
    this.markers.clear();
    this.diffs = [];
    if (hadDiffs) this.emitter.emit("did-update-diffs", this.diffs);
  }

  /**
   * @describe The memory releasing complement function of `destroyChildren`.
   *   frees the memory allocated at all child object storage locations
   *   when there is no repository.
   */
  releaseChildren() {
    this.diffs = null;
    this._repoSubs = null;
    this._animationId = null;
    this._animationWindow = null;
    this.editorPath = null;
    this.buffer = null;
    // Inputs of the last applied diff, for skipping no-op recomputations.
    this.bufferChangedSinceDiff = true;
    this.lastDiffInputs = null;
    this.diffAbortController = null;
  }

  /**
   * @describe handles all subscriptions based on the repository in focus
   */
  bindRepository(repository, { path: editorPath, ready, error }) {
    if (this.destroyed) return;
    if (ready && repository === this.repository && editorPath === this.editorPath) return;
    // Repository discovery is asynchronous. Invalidate the old repository's
    // request immediately so it cannot redraw this editor while its new path
    // is still being resolved.
    this.diffUpdateGeneration++;
    this.cancelDiffRequest();
    this.cancelScheduledUpdate();
    this._animationId = null;
    if (this._repoSubs !== null || this.repository !== null) this.clearAppliedDiffs();
    if (this._repoSubs !== null) {
      this._repoSubs.dispose();
      this.subscriptions.remove(this._repoSubs);
    }

    this.diffWork?.dispose();
    this.diffWork = null;
    this.repository = ready ? repository : null;
    if (error) console.error("Unable to resolve editor Git repository", error);
    if (this.repository !== null) {
      this.editorPath = editorPath;
      this.buffer = this.editor.getBuffer();
      this.diffWork = bufferDiffWork.acquire(this.buffer, this.repository);
      this.bufferChangedSinceDiff = true;
      this.lastDiffInputs = null;

      const updateIconDecoration = this.updateIconDecoration.bind(this);
      const editorScope = { scope: this.editor.getRootScopeDescriptor() };
      const scheduleUpdate = this.scheduleUpdate.bind(this);
      // Invalidate stale results immediately, then compare the final text of
      // this edit in a microtask. Waiting for onDidStopChanging added 300 ms
      // after the last keystroke, while tabs and the tree had already changed.
      const invalidateBufferDiff = () => {
        this.bufferChangedSinceDiff = true;
        this.diffUpdateGeneration++;
        this.cancelDiffRequest();
        this.scheduleBufferUpdate();
      };

      this._repoSubs = new CompositeDisposable(
        this.repository.onDidChangeStatusSnapshot(scheduleUpdate),
        this.buffer.onDidChange(invalidateBufferDiff),
        lumine.config.onDidChange("git-diff.showIconsInEditorGutter", updateIconDecoration),
        lumine.config.onDidChange("editor.showLineNumbers", editorScope, updateIconDecoration),
        this.editorElement.onDidAttach(updateIconDecoration),
      );

      // Every time the repo is changed, the editor needs to be reinitialized.
      this.subscriptions.add(this._repoSubs);

      updateIconDecoration();
      scheduleUpdate();
    } else {
      this.destroyChildren();
      this.releaseChildren();
      this.emitter.emit("did-update-diffs", []);
    }
  }

  moveToNextDiff() {
    const cursorLineNumber = this.editor.getCursorBufferPosition().row + 1;
    let nextDiffLineNumber = null;
    let firstDiffLineNumber = null;

    for (const { newStart } of this.diffs) {
      if (newStart > cursorLineNumber) {
        if (nextDiffLineNumber == null) nextDiffLineNumber = newStart - 1;

        nextDiffLineNumber = Math.min(newStart - 1, nextDiffLineNumber);
      }

      if (firstDiffLineNumber == null) firstDiffLineNumber = newStart - 1;

      firstDiffLineNumber = Math.min(newStart - 1, firstDiffLineNumber);
    }

    // Wrap around to the first diff in the file
    if (lumine.config.get("git-diff.wrapAroundOnMoveToDiff") && nextDiffLineNumber == null) {
      nextDiffLineNumber = firstDiffLineNumber;
    }

    this.moveToLineNumber(nextDiffLineNumber);
  }

  moveToPreviousDiff() {
    const cursorLineNumber = this.editor.getCursorBufferPosition().row + 1;
    let previousDiffLineNumber = null;
    let lastDiffLineNumber = null;
    for (const { newStart } of this.diffs) {
      if (newStart < cursorLineNumber) {
        previousDiffLineNumber = Math.max(newStart - 1, previousDiffLineNumber);
      }
      lastDiffLineNumber = Math.max(newStart - 1, lastDiffLineNumber);
    }

    // Wrap around to the last diff in the file
    if (lumine.config.get("git-diff.wrapAroundOnMoveToDiff") && previousDiffLineNumber === null) {
      previousDiffLineNumber = lastDiffLineNumber;
    }

    this.moveToLineNumber(previousDiffLineNumber);
  }

  updateIconDecoration() {
    const gutter = this.editorElement.querySelector('[gutter-name="line-number"]');
    if (gutter) {
      if (
        lumine.config.get("editor.showLineNumbers", {
          scope: this.editor.getRootScopeDescriptor(),
        }) &&
        lumine.config.get("git-diff.showIconsInEditorGutter")
      ) {
        gutter.classList.add("git-diff-icon");
      } else {
        gutter.classList.remove("git-diff-icon");
      }
    }
  }

  moveToLineNumber(lineNumber) {
    if (lineNumber !== null) {
      this.editor.setCursorBufferPosition([lineNumber, 0], { autoscroll: false });
      this.editor.moveToFirstCharacterOfLine({ mode: "zone" });
    }
  }

  scheduleUpdate() {
    if (this.destroyed || this.buffer == null || this.repository == null) return;

    // Use Chromium native requestAnimationFrame because it yields
    // to the browser, is standard and doesn't involve extra JS overhead.
    this.cancelScheduledUpdate();
    this._animationWindow = this.editorElement.ownerDocument.defaultView;
    this._animationId = this._animationWindow.requestAnimationFrame(() => {
      this._animationId = null;
      this._animationWindow = null;
      this.updateDiffs();
    });
  }

  scheduleBufferUpdate() {
    if (this.destroyed || this.buffer == null || this.repository == null) return;
    if (this.bufferUpdateQueued) return;
    this.cancelScheduledUpdate();
    this.bufferUpdateQueued = true;
    queueMicrotask(() => {
      if (!this.bufferUpdateQueued) return;
      this.bufferUpdateQueued = false;
      this.updateDiffs();
    });
  }

  cancelScheduledUpdate() {
    this.bufferUpdateQueued = false;
    if (this._animationId != null) this._animationWindow.cancelAnimationFrame(this._animationId);
    this._animationId = null;
    this._animationWindow = null;
  }

  getDiffInputs() {
    const statusEntry = this.repository.getStatusEntry(this.editorPath);
    const snapshot = this.repository.getStatusSnapshot();
    const bufferStatus = lumine.repositories.getBufferStatusSummary(this.editorPath, {
      repository: this.repository,
    });
    // Index blob identity catches repeated staging while the file remains MM.
    // Unrelated repository changes leave this editor's inputs unchanged.
    const key = JSON.stringify([
      snapshot.head.oid,
      snapshot.head.unborn,
      statusEntry?.headBlobOid ?? null,
      statusEntry?.indexBlobOid ?? null,
      statusEntry?.originalPath ?? null,
      Boolean(statusEntry?.staged),
      Boolean(statusEntry?.untracked),
      Boolean(statusEntry?.conflicted),
      Boolean(statusEntry?.ignored),
      Boolean(bufferStatus?.canDiff),
    ]);
    return { key, statusEntry, bufferStatus };
  }

  /**
   * @describe Uses text markers in the target editor to visualize
   *   git modifications, additions, and deletions. Computation is shared by
   *   buffer; unchanged decorations retain their existing markers.
   */
  async updateDiffs() {
    if (this.destroyed || this.buffer == null || this.repository == null) return;
    if (this.buffer.isDestroyed?.() || this.buffer.getLength() >= MAX_BUFFER_LENGTH_TO_DIFF) {
      // This invocation still supersedes an in-flight request even though it
      // cannot start another one. Otherwise the old result can redraw markers
      // for buffer contents that are no longer eligible to diff.
      this.diffUpdateGeneration++;
      this.cancelDiffRequest();
      this.diffWork?.invalidate();
      this.clearAppliedDiffs();
      return;
    }

    // Only this file's buffer and Git baselines affect its decorations. Reuse
    // them across repository events that change other files or remote refs.
    const repository = this.repository;
    const buffer = this.buffer;
    const editorPath = this.editorPath;
    const { key: inputs, statusEntry, bufferStatus } = this.getDiffInputs();
    if (!this.bufferChangedSinceDiff && inputs === this.lastDiffInputs) {
      return;
    }

    // The diff is now computed off-thread by the git-host worker, so guard
    // against a newer update (or teardown) landing before this one resolves.
    const generation = ++this.diffUpdateGeneration;
    this.bufferChangedSinceDiff = false;
    this.cancelDiffRequest();

    // Untracked and ignored files have no Git baseline. Conflicts, intent-to-add
    // entries and staged deletions have no usable index blob. Comparing their
    // buffers with empty text would mark the entire file as an addition.
    let diffs;
    if (!bufferStatus?.canDiff || (statusEntry && statusEntry.indexBlobOid == null)) {
      this.diffWork?.invalidate();
      diffs = [];
    } else {
      const controller = new AbortController();
      this.diffAbortController = controller;
      try {
        diffs = await this.diffWork.request({ inputs, editorPath, statusEntry });
        if (diffs === undefined) {
          if (generation === this.diffUpdateGeneration) this.bufferChangedSinceDiff = true;
          return;
        }
      } catch {
        // Nothing was applied; make sure the next trigger recomputes.
        if (!controller.signal.aborted && generation === this.diffUpdateGeneration) {
          this.bufferChangedSinceDiff = true;
        }
        controller.abort();
        return;
      } finally {
        if (this.diffAbortController === controller) this.diffAbortController = null;
      }
    }

    // A newer update superseded this one, or the view was torn down while the
    // worker was busy; drop the stale result without touching the markers.
    if (
      generation !== this.diffUpdateGeneration ||
      this.buffer !== buffer ||
      this.repository !== repository ||
      this.editorPath !== editorPath
    ) {
      return;
    }
    if (buffer.isDestroyed?.()) return;

    // A status snapshot may change before its scheduled animation frame runs.
    // Validate both baseline identities so the completed worker result can
    // never land in that interval.
    if (inputs !== this.getDiffInputs().key) return;

    this.lastDiffInputs = inputs;

    // Buffer markers already follow edits. Match their CURRENT ranges and
    // decoration kinds, so inserting lines above a hunk can reuse it too.
    const reusable = new Map();
    for (const [diff, marker] of this.markers) {
      if (!marker || marker.isDestroyed()) continue;
      const { klass } = this.markerDetails(diff);
      const range = marker.getBufferRange();
      const key = JSON.stringify([
        klass,
        diff.stage,
        range.start.row,
        range.start.column,
        range.end.row,
        range.end.column,
      ]);
      let entries = reusable.get(key);
      if (!entries) reusable.set(key, (entries = []));
      entries.push(marker);
    }
    const markers = new Map();
    for (const diff of diffs) {
      const { startRow, endRow, klass } = this.markerDetails(diff);
      // markBufferRange clips an end beyond EOF to the real buffer extent.
      const range = buffer.clipRange([
        [startRow, 0],
        [endRow, 0],
      ]);
      const key = JSON.stringify([
        klass,
        diff.stage,
        range.start.row,
        range.start.column,
        range.end.row,
        range.end.column,
      ]);
      const marker =
        reusable.get(key)?.pop() ?? this.markRange(startRow, endRow, klass, diff.stage);
      markers.set(diff, marker);
    }
    for (const entries of reusable.values()) for (const marker of entries) marker.destroy();
    this.markers = markers;
    this.diffs = diffs;

    // The memo-skip and stale-result paths above deliberately do not emit:
    // nothing changed for a subscriber, and a late one seeds from `this.diffs`.
    this.emitter.emit("did-update-diffs", this.diffs);
  }

  markerDetails({ newStart, oldLines, newLines }) {
    let startRow = newStart - 1;
    let endRow = newStart + newLines - 1;
    let klass;
    if (oldLines === 0 && newLines > 0) klass = "git-line-added";
    else if (newLines === 0 && oldLines > 0) {
      klass = startRow < 0 ? "git-previous-line-removed" : "git-line-removed";
      startRow = Math.max(0, startRow);
      endRow = startRow;
    } else klass = "git-line-modified";
    return { startRow, endRow, klass };
  }

  markRange(startRow, endRow, klass, stage) {
    if (this.editor.getBuffer().isDestroyed()) return;

    const marker = this.editor.markBufferRange(
      [
        [startRow, 0],
        [endRow, 0],
      ],
      {
        invalidate: "never",
      },
    );
    this.editor.decorateMarker(marker, {
      type: "line-number",
      class: stage === "staged" ? `${klass} git-line-staged` : klass,
    });
    return marker;
  }
};
