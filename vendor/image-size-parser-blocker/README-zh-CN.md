[English / 简体中文](README.md)

# image-size 图片解析阻断兼容包

此目录提供名为 `image-size` 的本地兼容包：保留下游需要的导出接口，但所有图片解析入口都会拒绝执行。目录名 `image-size-parser-blocker` 直接说明这一用途，包名仍为 `image-size`，以满足依赖解析。

Artemis 生成纯文本 PowerPoint 文件。PptxGenJS 4.0.1 将 `image-size` 声明为依赖，但其分发的运行时代码在此工作流中不导入它。

引入此兼容包时，已发布的 `image-size` 2.0.2 受 GHSA-w3rx-r6r6-pgpr 和 GHSA-5p2g-fcmc-qvqq 影响。本地替代包从安装后的攻击面中移除这些图片解析器，同时保留下游预期的导出；每个解析入口均默认拒绝。

在 PptxGenJS 不再声明 `image-size`，或上游修复版本可用且通过 Office 文档测试后，移除此覆盖配置。
