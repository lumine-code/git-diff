const { CompositeDisposable } = require("lumine");
const GitDiffView = require("./git-diff-view");
const DiffListView = require("./diff-list-view");

let diffListView = null;
let diffViews = new Set();
let viewsByEditor = new WeakMap();
let subscriptions = null;

module.exports = {
  activate(_state) {
    subscriptions = new CompositeDisposable();

    // The editor the dispatch came from, or the active one: Packages > Git Diff
    // dispatches at whatever holds focus, which is not always an editor.
    const editorForEvent = (event) => {
      const element = event?.target?.closest?.("lumine-text-editor:not([mini])");
      return element?.getModel?.() ?? lumine.workspace.getActiveTextEditor() ?? null;
    };

    // A view exists for every editor but its diffs only for one in a
    // repository, so a command that needs them says as much rather than
    // throwing on the null.
    const forDiffView = (method) => (event) => {
      const editor = editorForEvent(event);
      const diffView = editor && viewsByEditor.get(editor);
      if (!diffView || diffView.diffs == null) {
        lumine.notifications.addWarning("git-diff: no diff for this editor", {
          detail: "Open a file that belongs to a Git repository first.",
        });
        return;
      }
      diffView[method]();
    };

    subscriptions.add(
      // One registration on the workspace. The move commands used to be added
      // per editor inside the repository subscription, so they vanished for any
      // editor with no repository, and toggle-diff-list was added per editor
      // element for no reason — none of the three worked from the menu unless
      // an editor happened to have focus.
      lumine.commands.add("lumine-workspace", {
        "git-diff:toggle-diff-list": {
          description: "List every changed line in this file and jump to one.",
          didDispatch: () => {
            if (diffListView == null) {
              diffListView = new DiffListView((editor) => viewsByEditor.get(editor)?.diffs);
            }
            diffListView.toggle();
          },
        },
        "git-diff:move-to-next-diff": {
          description: "Move the cursor to the next change against Git HEAD.",
          didDispatch: forDiffView("moveToNextDiff"),
        },
        "git-diff:move-to-previous-diff": {
          description: "Move the cursor to the previous change against Git HEAD.",
          didDispatch: forDiffView("moveToPreviousDiff"),
        },
      }),
      lumine.workspace.observeTextEditors((editor) => {
        const editorElement = lumine.views.getView(editor);
        const diffView = new GitDiffView(editor, editorElement);

        diffViews.add(diffView);
        viewsByEditor.set(editor, diffView);

        const editorSubs = new CompositeDisposable(
          editor.onDidDestroy(() => {
            diffView.destroy();
            diffViews.delete(diffView);
            viewsByEditor.delete(editor);
            editorSubs.dispose();
            subscriptions.remove(editorSubs);
          }),
        );

        subscriptions.add(editorSubs);
      }),
    );
  },

  deactivate() {
    diffListView = null;

    for (const diffView of diffViews) diffView.destroy();

    diffViews.clear();

    subscriptions.dispose();
    subscriptions = null;
  },
};
