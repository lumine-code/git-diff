module.exports = class DiffListView {
  // `getDiffs(editor)` hands back the line diffs the editor's GitDiffView
  // already computed — the list never runs its own diff.
  constructor(getDiffs) {
    this.getDiffs = getDiffs;
    this.destroyed = false;
    this.requestVersion = 0;
    this.selectListHost = lumine.workspace.addSelectList(
      {
        emptyMessage: "No diffs in file",
        items: [],
        getItemId: ({ oldStart, oldLines, newStart, newLines }) =>
          JSON.stringify([oldStart, oldLines, newStart, newLines]),
        search: { getFilterText: (diff) => diff.lineText },
        renderItem: (diff, { filterKey, highlight }) => ({
          primary: highlight(filterKey),
          secondary: `-${diff.oldStart},${diff.oldLines} +${diff.newStart},${diff.newLines}`,
        }),
        commands: {
          "git-diff:open-diff": {
            description: "Move the cursor to the selected diff hunk.",
            didDispatch: (event) => this.openDiff(event.detail.item),
          },
        },
        actions: [
          {
            command: "git-diff:open-diff",
            context: "item",
            primary: true,
            disposition: "close",
            dispatch: "local",
          },
        ],
      },
      { className: "diff-list-view", crumb: "Diffs" },
    );
    this.selectList = this.selectListHost.getModel();
    this.cancelSubscription = this.selectListHost.onDidCancel(() => {
      this.requestVersion++;
      this.editor = null;
    });
  }

  openDiff(diff) {
    if (this.destroyed || !this.editor || this.editor.isDestroyed()) return;
    const bufferRow = diff.newStart > 0 ? diff.newStart - 1 : diff.newStart;
    this.editor.setCursorBufferPosition([bufferRow, 0], {
      autoscroll: true,
    });
    this.editor.moveToFirstCharacterOfLine();
  }

  destroy() {
    if (!this.destroyed) {
      this.destroyed = true;
      this.requestVersion++;
      this.editor = null;
      this.cancelSubscription.dispose();
    }
    return this.selectListHost.destroy();
  }

  async toggle() {
    if (this.destroyed || this.selectListHost.isDestroyed()) return;
    const version = ++this.requestVersion;
    const editor = lumine.workspace.getActiveTextEditor();
    if (this.selectListHost.isVisible()) {
      this.selectListHost.hide();
    } else if (editor) {
      this.editor = editor;
      // Copies, not the shared diff objects: the view and the marker layer
      // read them too, and `lineText` is this list's own decoration.
      const items = (this.getDiffs(editor) ?? []).map((diff) => {
        const bufferRow = diff.newStart > 0 ? diff.newStart - 1 : diff.newStart;
        const lineText = editor.lineTextForBufferRow(bufferRow);
        return { ...diff, lineText: lineText ? lineText.trim() : "" };
      });

      try {
        await this.selectList.setItems(items);
      } catch (error) {
        if (!this.isCurrentRequest(version, editor)) return;
        throw error;
      }
      if (!this.isCurrentRequest(version, editor)) return;
      this.selectListHost.show();
    }
  }

  isCurrentRequest(version, editor) {
    return (
      !this.destroyed &&
      this.requestVersion === version &&
      this.editor === editor &&
      !editor.isDestroyed() &&
      !this.selectListHost.isDestroyed()
    );
  }
};
