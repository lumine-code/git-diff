const { Disposable } = require("lumine");

// The `marker.layer` provider: the git-diff layer on the overview maps.
//
// Fed by each editor's GitDiffView, so one diff computation serves the gutter,
// the diff list and this layer. This module only carries the handover between
// the views (owned by main.js) and the layers (owned by the marker hub) —
// whichever side arrives first, the other finds it current.
// The view owns live gutter markers, so their projection keeps following edits
// while the next comparison is pending, without copying numeric hunk positions.
module.exports = {
  activate() {
    this.layers = new Map();
    this.views = new Map();
    this.viewSubs = new Map();
  },

  deactivate() {
    for (const sub of this.viewSubs?.values() || []) sub.dispose();
    this.viewSubs?.clear();
    this.views?.clear();
    this.layers?.clear();
  },

  attachView(editor, view) {
    this.viewSubs.get(editor)?.dispose();
    this.views.set(editor, view);
    this.viewSubs.set(
      editor,
      view.onDidUpdateDiffs(() => this.publish(editor)),
    );
    this.publish(editor);
  },

  detachView(editor) {
    this.viewSubs.get(editor)?.dispose();
    this.viewSubs.delete(editor);
    this.views.delete(editor);
    this.publish(editor);
  },

  publish(editor) {
    this.layers.get(editor)?.update();
  },

  provideMarkerLayer() {
    return {
      name: "git-diff",
      description: "Git diff markers",
      position: "right",
      merge: true,
      enabled: "git-diff.marker.enabled",
      threshold: "git-diff.marker.threshold",
      initialize: (layer) => {
        this.layers.set(layer.editor, layer);
        layer.disposables.add(
          new Disposable(() => {
            this.layers.delete(layer.editor);
          }),
        );
        layer.update();
      },
      getItems: ({ editor }) => {
        const items = [];
        const view = this.views.get(editor);
        if (!view) return items;
        for (const [{ oldLines, newLines, stage }, marker] of view.markers) {
          if (!marker || marker.isDestroyed()) continue;
          let cls;
          if (oldLines === 0 && newLines > 0) {
            cls = "added";
          } else if (newLines === 0 && oldLines > 0) {
            cls = "removed";
          } else {
            cls = "modified";
          }
          const range = marker.getScreenRange();
          const row = range.start.row;
          const end = range.end.row - (range.end.column === 0 && range.end.row > row ? 1 : 0);
          items.push({
            row,
            end,
            cls: stage === "staged" ? `${cls} staged` : cls,
          });
        }
        return items;
      },
    };
  },
};
