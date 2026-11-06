// Keep verification imports outside the shipped dependency graph.
export function desktopMainEntry(packageBuild) {
  return packageBuild
    ? "src/main/bootstrap.ts"
    : "test/fixtures/application/desktop-entry.ts";
}
