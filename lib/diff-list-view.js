module.exports = class DiffListView {
  // `getDiffs(editor)` hands back the line diffs the editor's GitDiffView
  // already computed — the list never runs its own diff.
  constructor(getDiffs) {
    this.getDiffs = getDiffs;
    this.selectListView = lumine.workspace.buildSelectList({
      className: "diff-list-view",
      crumb: "Diffs",
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
    });
  }

  openDiff(diff) {
    const bufferRow = diff.newStart > 0 ? diff.newStart - 1 : diff.newStart;
    this.editor.setCursorBufferPosition([bufferRow, 0], {
      autoscroll: true,
    });
    this.editor.moveToFirstCharacterOfLine();
  }

  destroy() {
    return this.selectListView.destroy();
  }

  async toggle() {
    const editor = lumine.workspace.getActiveTextEditor();
    if (this.selectListView.isVisible()) {
      this.selectListView.hide();
    } else if (editor) {
      this.editor = editor;
      // Copies, not the shared diff objects: the view and the marker layer
      // read them too, and `lineText` is this list's own decoration.
      const items = (this.getDiffs(editor) ?? []).map((diff) => {
        const bufferRow = diff.newStart > 0 ? diff.newStart - 1 : diff.newStart;
        const lineText = this.editor.lineTextForBufferRow(bufferRow);
        return { ...diff, lineText: lineText ? lineText.trim() : "" };
      });

      await this.selectListView.setItems(items);
      this.selectListView.show();
    }
  }
};
