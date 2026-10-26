const { CompositeDisposable } = require("lumine");

module.exports = class DiffListView {
  // `getDiffs(editor)` hands back the line diffs the editor's GitDiffView
  // already computed — the list never runs its own diff.
  constructor(getDiffs, window = lumine.workspace.getMainWindow(), { observeDiffs } = {}) {
    this.window = window;
    this.getDiffs = getDiffs;
    this.observeDiffs = observeDiffs;
    this.editorSubscriptions = new CompositeDisposable();
    this.destroyed = false;
    this.requestVersion = 0;
    this.selectListHost = lumine.workspace.addSelectList(
      {
        emptyMessage: "No diffs in file",
        items: [],
        getItemId: ({ stage, oldStart, oldLines, newStart, newLines }) =>
          JSON.stringify([stage, oldStart, oldLines, newStart, newLines]),
        search: { getFilterText: (diff) => diff.lineText },
        renderItem: (diff, { filterKey, highlight }) => ({
          primary: highlight(filterKey),
          secondary: `${diff.stage === "staged" ? "Staged" : "Unstaged"} · -${diff.oldStart},${diff.oldLines} +${diff.newStart},${diff.newLines}`,
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
      { className: "diff-list-view", crumb: "Diffs", window },
    );
    this.selectList = this.selectListHost.getModel();
    this.cancelSubscription = new CompositeDisposable(
      this.selectListHost.onDidHide(() => this.clearEditor()),
      this.selectListHost.onDidCancel(() => this.clearEditor()),
    );
  }

  clearEditor() {
    this.requestVersion++;
    this.editor = null;
    this.editorSubscriptions.dispose();
    this.editorSubscriptions = new CompositeDisposable();
  }

  async refresh(editor = this.editor) {
    if (
      this.destroyed ||
      editor !== this.editor ||
      !editor ||
      editor.isDestroyed() ||
      editor.getGrammar() === lumine.grammars.nullGrammar
    )
      return;
    const version = this.requestVersion;
    const items = (this.getDiffs(editor) ?? []).map((diff) => {
      const bufferRow = diff.newStart > 0 ? diff.newStart - 1 : diff.newStart;
      const lineText = editor.lineTextForBufferRow(bufferRow);
      return { ...diff, lineText: lineText ? lineText.trim() : "" };
    });
    try {
      await this.selectList.setItems(items);
    } catch (error) {
      if (this.isCurrentRequest(version, editor)) throw error;
    }
  }

  openDiff(diff) {
    if (
      this.destroyed ||
      !this.editor ||
      this.editor.isDestroyed() ||
      this.editor.getGrammar() === lumine.grammars.nullGrammar
    )
      return;
    const bufferRow = diff.newStart > 0 ? diff.newStart - 1 : diff.newStart;
    this.editor.setCursorBufferPosition([bufferRow, 0], {
      autoscroll: false,
    });
    this.editor.moveToFirstCharacterOfLine({ mode: "zone" });
  }

  destroy() {
    if (!this.destroyed) {
      this.destroyed = true;
      this.clearEditor();
      this.cancelSubscription.dispose();
    }
    return this.selectListHost.destroy();
  }

  async toggle(editor = this.window.getEditorContainer().getActiveEmbeddedTextEditor()) {
    if (this.destroyed || this.selectListHost.isDestroyed()) return;
    if (this.selectListHost.isVisible()) {
      this.selectListHost.hide();
    } else if (
      editor &&
      !editor.isDestroyed() &&
      editor.getGrammar() !== lumine.grammars.nullGrammar
    ) {
      this.clearEditor();
      const version = this.requestVersion;
      this.editor = editor;
      this.editorSubscriptions.add(
        editor.onDidDestroy(() => this.selectListHost.cancel("editor-destroyed")),
        editor.onDidChangeGrammar(() => {
          if (editor.getGrammar() !== lumine.grammars.nullGrammar) return;
          this.clearEditor();
          this.selectListHost.cancel("grammar-disabled");
        }),
      );
      const updates = this.observeDiffs?.(editor, () => {
        void this.refresh(editor).catch((error) =>
          console.error("Could not refresh diff choices", error),
        );
      });
      if (updates) this.editorSubscriptions.add(updates);
      await this.refresh(editor);
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
      editor.getGrammar() !== lumine.grammars.nullGrammar &&
      !this.selectListHost.isDestroyed()
    );
  }
};
