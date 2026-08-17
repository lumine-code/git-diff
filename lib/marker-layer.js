const { Disposable } = require("lumine");

// The `marker.layer` provider: the git-diff layer on the overview maps.
//
// Fed by each editor's GitDiffView, so one diff computation serves the gutter,
// the diff list and this layer. This module only carries the handover between
// the views (owned by main.js) and the layers (owned by the marker hub) —
// whichever side arrives first, the other finds it current.
module.exports = {
  activate() {
    this.layers = new Map();
    this.views = new Map();
    this.viewSubs = new Map();
  },

  deactivate() {
    for (const sub of this.viewSubs.values()) sub.dispose();
    this.viewSubs.clear();
    this.views.clear();
    this.layers.clear();
  },

  attachView(editor, view) {
    this.views.set(editor, view);
    this.viewSubs.set(
      editor,
      view.onDidUpdateDiffs((diffs) => this.publish(editor, diffs)),
    );
    // A layer attached before the view existed starts on the current hunks.
    if (view.diffs != null) this.publish(editor, view.diffs);
  },

  detachView(editor) {
    this.viewSubs.get(editor)?.dispose();
    this.viewSubs.delete(editor);
    this.views.delete(editor);
  },

  publish(editor, diffs) {
    const layer = this.layers.get(editor);
    if (!layer) return;
    layer.cache.set("diffs", diffs ?? []);
    layer.update();
  },

  provideMarkerLayer() {
    return {
      name: "git-diff",
      description: "Git diff markers",
      position: "right",
      timer: 100,
      merge: true,
      enabled: "git-diff.marker.enabled",
      threshold: "git-diff.marker.threshold",
      initialize: (layer) => {
        this.layers.set(layer.editor, layer);
        // A view attached before the layer existed seeds it; later
        // recomputations arrive through the view's event.
        layer.cache.set("diffs", this.views.get(layer.editor)?.diffs ?? []);
        layer.disposables.add(
          new Disposable(() => {
            this.layers.delete(layer.editor);
          }),
        );
      },
      getItems: ({ editor, cache }) => {
        const items = [];
        for (const { newStart, oldLines, newLines } of cache.get("diffs") ?? []) {
          let cls, startRow, endRow;
          if (oldLines === 0 && newLines > 0) {
            cls = "added";
            startRow = newStart - 1;
            endRow = newStart + newLines - 2;
          } else if (newLines === 0 && oldLines > 0) {
            cls = "removed";
            startRow = Math.max(newStart - 1, 0);
            endRow = startRow;
          } else {
            cls = "modified";
            startRow = newStart - 1;
            endRow = Math.max(newStart + newLines - 2, startRow);
          }
          items.push({
            row: editor.screenRowForBufferRow(startRow),
            end: editor.screenRowForBufferRow(endRow),
            cls,
          });
        }
        return items;
      },
    };
  },
};
