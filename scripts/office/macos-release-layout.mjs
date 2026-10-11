import { join } from "node:path";
import { execFileSync } from "node:child_process";

export function macOfficeIsMachO(path, header) {
  if (
    ![
      0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
      0xcafebabf,
    ].includes(header.readUInt32BE())
  )
    return false;
  // Java class files share the universal Mach-O magic; inspect the format too.
  return execFileSync("/usr/bin/file", ["-b", path], {
    encoding: "utf8",
  }).startsWith("Mach-O");
}

export function macOfficeRuntimeSourceFilter(path) {
  // Keep optional scripts and database configuration out of sealed code paths.
  return !/(?:^|\/)(?:_CodeSignature|sdk|help|gallery|template|Scripts|python(?:-core-[^/]+|[0-9.]*|\.bin)|LibreOfficePython\.framework)(?:\/|$)|\/(?:libpython[^/]*|pyuno\.so|libpyuno[^/]*|libpythonloader[^/]*)$|\/Contents\/MacOS\/(?:senddoc|unoinfo)$|\/Contents\/(?:Frameworks|MacOS\/urelibs)\/intl\/fbintl\.conf$/iu.test(
    path.replaceAll("\\", "/"),
  );
}

export function macOfficeSigningTargets(macho, bundles, app) {
  // Signing the main executable implicitly signs its bundle; do that last.
  const main = join(app, "Contents", "MacOS", "soffice");
  return [...macho.filter((path) => path !== main), ...bundles, app];
}
