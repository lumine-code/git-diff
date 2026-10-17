describe("Git Diff initialization cleanup", () => {
  it("unloads an initial bootstrap before diff views and marker maps have activated", async () => {
    const pack = lumine.packages.loadPackage("git-diff");
    pack.requireMainModule();
    pack.initializeForExternalUse("initial package bootstrap");
    const context = pack.lifecycleContext;
    expect(pack.mainInitialized).toBe(true);
    expect(pack.mainActivated).toBe(false);

    await lumine.packages.unloadPackage("git-diff", { serialize: false });

    expect(context.subscriptions.disposed).toBe(true);
    expect(lumine.packages.isPackageLoaded("git-diff")).toBe(false);
  });
});
