// 出站媒体提取（证据：ggcode internal/im/image_extract.go 移植 + 视频扩展）

import { describe, expect, it } from "vitest";

import {
  decodeDataImageUrl,
  extractMediaFromText,
  isLocalMediaPath,
} from "../src/media.js";

describe("extractMediaFromText（出站富媒体，对齐 ggcode ExtractImagesFromText）", () => {
  it("markdown 图片：提取 URL 并保留 alt 文本", () => {
    const { media, text } = extractMediaFromText("看这张 ![截图](https://x.com/a.png) 图");
    expect(media).toEqual([
      { kind: "image", source: "https://x.com/a.png" },
    ]);
    expect(text).toBe("看这张 截图 图");
  });

  it("裸图片 URL：提取并移除", () => {
    const { media, text } = extractMediaFromText("结果见 https://x.com/r.jpeg 请查收");
    expect(media).toEqual([{ kind: "image", source: "https://x.com/r.jpeg" }]);
    expect(text).toBe("结果见 请查收");
  });

  it("data:image base64：提取 dataURL", () => {
    const dataUrl = "data:image/png;base64,aGVsbG8=";
    const { media, text } = extractMediaFromText(`图：${dataUrl} 完成`);
    expect(media).toEqual([{ kind: "image", source: dataUrl }]);
    expect(text).toBe("图： 完成");
  });

  it("本地 .mp4 视频路径：提取（markdown 与裸路径）", () => {
    const md = extractMediaFromText("回放 ![演示](/tmp/demo.mp4) 已生成");
    expect(md.media).toEqual([{ kind: "video", source: "/tmp/demo.mp4" }]);
    expect(md.text).toBe("回放 演示 已生成");

    const bare = extractMediaFromText("回放 ./demo.mp4 已生成");
    expect(bare.media).toEqual([{ kind: "video", source: "./demo.mp4" }]);
    expect(bare.text).toBe("回放 已生成");
  });

  it("多图去重：同 URL 只提取一次", () => {
    const { media } = extractMediaFromText(
      "![a](https://x.com/a.png) 和 ![b](https://x.com/a.png)",
    );
    expect(media).toEqual([{ kind: "image", source: "https://x.com/a.png" }]);
  });

  it("无媒体：原文本不变", () => {
    const { media, text } = extractMediaFromText("纯文字消息 hello");
    expect(media).toEqual([]);
    expect(text).toBe("纯文字消息 hello");
  });

  it("data URL 解码为 Buffer", () => {
    const buf = decodeDataImageUrl("data:image/png;base64,aGVsbG8=");
    expect(buf?.toString("utf8")).toBe("hello");
  });

  it("非法 data URL 返回 null", () => {
    expect(decodeDataImageUrl("data:image/png;base64,!!!")).toBeNull();
  });
});

describe("isLocalMediaPath（对齐 ggcode IsLocalFilePath，扩展 mp4）", () => {
  it("绝对路径 / 相对前缀", () => {
    expect(isLocalMediaPath("/tmp/a.png")).toBe(true);
    expect(isLocalMediaPath("./a.jpg")).toBe(true);
    expect(isLocalMediaPath("../b.webp")).toBe(true);
  });
  it("扩展名判定（含 mp4）", () => {
    expect(isLocalMediaPath("demo.mp4")).toBe(true);
    expect(isLocalMediaPath("photo.jpeg")).toBe(true);
    expect(isLocalMediaPath("archive.zip")).toBe(false);
  });
  it("URL 不是本地路径", () => {
    expect(isLocalMediaPath("https://x.com/a.png")).toBe(false);
  });
});