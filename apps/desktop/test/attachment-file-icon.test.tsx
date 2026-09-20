// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  AttachmentFileIcon,
  attachmentFileType,
} from "../src/renderer/AttachmentFileIcon.js";

afterEach(cleanup);
it.each([
  ["C:\\src\\MAIN.TS", "code", "TS"],
  ["/app/main.py", "code", "PY"],
  ["lib.rs", "code", "RS"],
  ["main.go", "code", "GO"],
  ["README.mdx", "markdown", "MD"],
  ["server.LOG", "log", "LOG"],
  ["config.json", "config", "JSON"],
  ["config.yaml", "yaml", "YAML"],
  [".env.production", "config", "ENV"],
  ["Dockerfile.dev", "build", "DOCK"],
  ["Makefile", "build", "MAKE"],
  [".gitignore", "git", "GIT"],
  [".zshrc", "script", "SH"],
  ["run.ps1", "script", "PS"],
  ["table.csv", "sheet", "CSV"],
  ["query.sql", "data", "SQL"],
  ["report.pdf", "pdf", "PDF"],
  ["report.docx", "document", "DOCX"],
  ["table.xlsx", "sheet", "XLSX"],
  ["slides.pptx", "slides", "PPTX"],
  ["backup.tar.gz", "archive", "ZIP"],
  ["image.png", "image", "IMG"],
  ["song.flac", "audio", "AUD"],
  ["clip.mov", "video", "VID"],
  ["font.woff2", "font", "Aa"],
  ["unknown.xyz", "file", "FILE"],
  ["no-extension", "file", "FILE"],
  ["constructor", "file", "FILE"],
  ["file.__proto__", "file", "FILE"],
  ["ts", "file", "FILE"],
])("identifies %s", (name, family, label) => {
  expect(attachmentFileType(name)).toMatchObject({ family, label });
});
it("keeps filename markup out of SVG and gives repeated icons unique gradients", () => {
  const { container } = render(
    <>
      <AttachmentFileIcon name={"<script>alert(1)</script>.ts"} />
      <AttachmentFileIcon name="other.ts" />
    </>,
  );
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelectorAll("[data-file-label='TS']")).toHaveLength(2);
  const gradients = [...container.querySelectorAll("linearGradient")].map(
    (node) => node.id,
  );
  expect(new Set(gradients).size).toBe(2);
});

it.each([
  ["app.py", "python"],
  ["lib.rs", "rust"],
  ["Main.java", "java"],
  ["Dockerfile", "docker"],
  ["style.css", "braces"],
  ["report.pdf", "pdf"],
  ["README.md", "markdown"],
])("preserves the distinct approved artwork for %s", (name, artwork) => {
  const { container } = render(<AttachmentFileIcon name={name} />);
  expect(
    container.querySelector("svg")?.getAttribute("data-file-artwork"),
  ).toBe(artwork);
});

it("keeps Markdown and Python free of redundant footer labels", () => {
  const { container } = render(
    <>
      <AttachmentFileIcon name="README.md" />
      <AttachmentFileIcon name="app.py" />
    </>,
  );
  expect(container.querySelectorAll("text")).toHaveLength(0);
});
