describe("Git Diff picker pending ownership", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let view, editor, diff, fixture;

  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  };

  beforeEach(async () => {
    await lumine.packages.activatePackage("git-diff");
    const DiffListView = require("../lib/diff-list-view");
    editor = await lumine.workspace.open();
    editor.setText("first\nchanged\nlast\n");
    editor.setCursorBufferPosition([0, 0]);
    diff = { oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, stage: "unstaged" };
    view = new DiffListView(() => [diff]);
  });

  afterEach(async () => {
    await view.destroy();
    await fixture?.cleanup();
    fixture = null;
  });

  it("settles an item update after destruction without showing its dead host", async () => {
    const update = deferred();
    spyOn(view.selectList, "setItems").and.returnValue(update.promise);
    const show = spyOn(view.selectListHost, "show").and.callThrough();
    const result = view.toggle().then(
      () => null,
      (error) => error,
    );
    await view.destroy();
    update.resolve();

    expect(await result).toBeNull();
    expect(show).not.toHaveBeenCalled();
  });

  it("preserves the latest editor when two pending opens finish in reverse order", async () => {
    const update = deferred();
    spyOn(view.selectList, "setItems").and.returnValues(update.promise, Promise.resolve());
    const show = spyOn(view.selectListHost, "show").and.callThrough();
    const older = view.toggle();
    const current = await lumine.workspace.open();
    current.setText("new\ncurrent change\n");
    await view.toggle();
    update.resolve();
    await older;

    expect(show).toHaveBeenCalledTimes(1);
    view.openDiff(diff);
    expect(current.getCursorBufferPosition()).toEqual([1, 0]);
    expect(editor.getCursorBufferPosition()).toEqual([0, 0]);
  });

  it("does not undo a newer hide when the first update finishes", async () => {
    const update = deferred();
    spyOn(view.selectList, "setItems").and.returnValue(update.promise);
    const pending = view.toggle();
    view.selectListHost.show();
    await view.toggle();
    expect(view.selectListHost.isVisible()).toBe(false);
    update.resolve();
    await pending;

    expect(view.selectListHost.isVisible()).toBe(false);
  });

  it("does not reopen a pending picker after cancellation", async () => {
    const update = deferred();
    spyOn(view.selectList, "setItems").and.returnValue(update.promise);
    const show = spyOn(view.selectListHost, "show").and.callThrough();
    const pending = view.toggle();
    view.selectListHost.cancel();
    update.resolve();
    await pending;

    expect(show).not.toHaveBeenCalled();
  });

  it("does not show an update for a destroyed captured editor", async () => {
    const update = deferred();
    spyOn(view.selectList, "setItems").and.returnValue(update.promise);
    const show = spyOn(view.selectListHost, "show").and.callThrough();
    const pending = view.toggle();
    editor.destroy();
    update.resolve();
    await pending;

    expect(show).not.toHaveBeenCalled();
  });

  it("preserves the captured editor and copied hunks through an active-tab change", async () => {
    const original = view.selectList.setItems.bind(view.selectList);
    const update = deferred();
    spyOn(view.selectList, "setItems").and.callFake(async (items) => {
      await original(items);
      await update.promise;
    });
    const pending = view.toggle();
    const other = await lumine.workspace.open();
    update.resolve();
    await pending;
    await view.selectList.selectIndex(0);
    await view.selectList.confirmSelection();

    expect(editor.getCursorBufferPosition()).toEqual([1, 0]);
    expect(other.getCursorBufferPosition()).toEqual([0, 0]);
    expect(diff.lineText).toBeUndefined();
  });

  it("keeps repeated hunk navigation attached to the initiating editor", async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    const second = { ...diff, oldStart: 3, newStart: 3 };
    view.getDiffs = () => [diff, second];
    const other = await lumine.workspace.open();
    await view.toggle(editor);
    await view.selectList.runAction("select-list:toggle-keep-open");

    for (let index = 0; index < 2; index++) {
      await view.selectList.selectIndex(index);
      await view.selectList.confirmSelection();
      expect(editor.getCursorBufferPosition()).toEqual([index + 1, 0]);
      expect(other.getCursorBufferPosition()).toEqual([0, 0]);
      expect(view.selectListHost.isVisible()).toBe(true);
    }
  });

  it("refreshes owned hunks through flow suspension and releases the source on dismissal", async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    let updated;
    const disposed = jasmine.createSpy("dispose diff updates");
    view.observeDiffs = (owner, callback) => {
      expect(owner).toBe(editor);
      updated = callback;
      return { dispose: disposed };
    };
    await view.toggle(editor);
    const list = view.selectList;
    await list.runAction("select-list:toggle-keep-open");
    await list.setQuery("changed");
    const selectedId = list.getSelectedItemId();
    await view.selectListHost.showActions();
    expect(disposed).not.toHaveBeenCalled();
    editor.setText("first\nchanged again\nlast\n");
    updated();
    await conditionPromise(
      () => !list.isFiltering() && list.getItems()[0].lineText === "changed again",
    );
    lumine.workspace.popModal();
    expect(view.selectListHost.isVisible()).toBe(true);
    expect(list.getQuery()).toBe("changed");
    expect(list.getSelectedItemId()).toBe(selectedId);
    await list.confirmSelection();
    expect(editor.getCursorBufferPosition()).toEqual([1, 0]);
    expect(view.selectListHost.isVisible()).toBe(true);

    view.selectListHost.cancel();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(view.editor).toBeNull();
    const publish = spyOn(list, "setItems").and.callThrough();
    updated();
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
  });

  it("cancels a visible retained picker when its owning editor is destroyed", async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    await view.toggle(editor);
    await view.selectList.runAction("select-list:toggle-keep-open");
    editor.destroy();
    expect(view.selectListHost.isVisible()).toBe(false);
    expect(view.editor).toBeNull();
  });

  it("ignores a failed item update belonging to a destroyed picker", async () => {
    const update = deferred();
    spyOn(view.selectList, "setItems").and.returnValue(update.promise);
    const result = view.toggle().then(
      () => null,
      (error) => error,
    );
    await view.destroy();
    update.reject(new Error("retired update"));

    expect(await result).toBeNull();
  });

  it("preserves a failed item update belonging to the current picker", async () => {
    const error = new Error("current update failed");
    spyOn(view.selectList, "setItems").and.rejectWith(error);

    await expectAsync(view.toggle()).toBeRejectedWith(error);
  });

  it("destroys the actual command's pending picker when the package deactivates", async () => {
    fixture = await require("./changed-editor-fixture")();
    const update = deferred();
    const addList = lumine.workspace.addSelectList.bind(lumine.workspace);
    let host, commandResult;
    spyOn(lumine.workspace, "addSelectList").and.callFake((...args) => {
      host = addList(...args);
      spyOn(host.getModel(), "setItems").and.returnValue(update.promise);
      return host;
    });
    const DiffListView = require("../lib/diff-list-view");
    const toggle = DiffListView.prototype.toggle;
    spyOn(DiffListView.prototype, "toggle").and.callFake(function () {
      commandResult = toggle.call(this).then(
        () => null,
        (error) => error,
      );
      return commandResult;
    });
    const dispatched = lumine.commands.dispatch(
      lumine.views.getView(lumine.workspace),
      "git-diff:toggle-diff-list",
    );
    await lumine.packages.deactivatePackage("git-diff");
    update.resolve();
    await dispatched;
    expect(await commandResult).toBeNull();
    expect(host.isDestroyed()).toBe(true);
    expect(host.isVisible()).toBe(false);
    await host.destroy();
  });

  it("closes the actual command's picker and disables reopening after its editor disappears", async () => {
    fixture = await require("./changed-editor-fixture")();
    const addList = lumine.workspace.addSelectList.bind(lumine.workspace);
    let host;
    spyOn(lumine.workspace, "addSelectList").and.callFake((...args) => {
      host = addList(...args);
      return host;
    });
    await lumine.commands.dispatch(fixture.editor.getElement(), "git-diff:toggle-diff-list");
    expect(host.isVisible()).toBe(true);
    fixture.editor.destroy();
    editor.destroy();
    const target = lumine.workspace.getElement();
    expect(host.isVisible()).toBe(false);
    expect(lumine.commands.canDispatch(target, "git-diff:toggle-diff-list")).toBe(false);
    expect(lumine.commands.dispatch(target, "git-diff:toggle-diff-list")).toBeNull();
  });

  it("allows closing a live owner's visible picker without active editor resolution", async () => {
    fixture = await require("./changed-editor-fixture")();
    const addList = lumine.workspace.addSelectList.bind(lumine.workspace);
    let host;
    spyOn(lumine.workspace, "addSelectList").and.callFake((...args) => {
      host = addList(...args);
      return host;
    });
    await lumine.commands.dispatch(fixture.editor.getElement(), "git-diff:toggle-diff-list");
    const container = lumine.workspace.getMainWindow().getEditorContainer();
    const activeItem = spyOn(container.getActivePane(), "getActiveItem").and.returnValue(null);
    const embedded = spyOn(container, "getActiveEmbeddedTextEditor").and.returnValue(null);
    try {
      const target = lumine.workspace.getElement();
      expect(lumine.workspace.resolveCommandContext(target).editor).toBeFalsy();
      expect(lumine.commands.canDispatch(target, "git-diff:move-to-next-diff")).toBe(false);
      expect(fixture.editor.isDestroyed()).toBe(false);
      expect(host.isVisible()).toBe(true);
      expect(lumine.commands.canDispatch(target, "git-diff:toggle-diff-list")).toBe(true);

      await lumine.commands.dispatch(target, "git-diff:toggle-diff-list");

      expect(host.isVisible()).toBe(false);
    } finally {
      activeItem.and.callThrough();
      embedded.and.callThrough();
    }
  });
});
