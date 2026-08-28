<div align="center">

<img src="./src-tauri/icons/icon.png" width="120" alt="花笺·新枝图标">

# 花笺·新枝

**Huajian Xinzhi**

一张会整理文件、会同步、还能趴着一只橘猫的本地写作纸。

[下载最新版](https://github.com/ly20030823/huajian-xinzhi/releases/latest) ·
[反馈问题](https://github.com/ly20030823/huajian-xinzhi/issues) ·
[从源码构建](#从源码构建)

[![Version](https://img.shields.io/github/v/release/ly20030823/huajian-xinzhi)](https://github.com/ly20030823/huajian-xinzhi/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-2f6fed?logo=windows)](https://github.com/ly20030823/huajian-xinzhi/releases/latest)

</div>

---

## 它是什么

花笺·新枝是一个基于 Tauri 2、React 和 Rust 构建的本地笔记与 Markdown
写作工具。它延续了 Floral Notepaper 轻巧、安静的气质，又长出了更完整的
文件管理、富文本编辑、资料阅读和多设备同步能力。

笔记默认保存在你选择的真实文件夹中，不被困在数据库里。你可以继续用其他
编辑器、文件管理器或备份软件处理这些文件。

## 新枝上长了什么

- **所见即所得 Markdown 编辑**：标题、列表、引用、任务列表、表格、公式、
  代码块和 Mermaid 流程图都能直接编辑，也可以随时打开 Markdown 源码。
- **真正的文件夹工作区**：直接打开本地目录，支持新建文件夹、拖动归类、
  调整文件和文件夹顺序，并可从磁盘重新加载。
- **更顺手的表格与代码块**：列宽拖动、列顺序调整、批量对齐、右键菜单、
  行号、语言识别和语法高亮。
- **快捷便签**：任意笔记可打开成小窗，默认只读防误触，需要时再解锁编辑，
  支持置顶和主题切换。
- **GitHub 多设备同步**：无需本机安装 Git；不同本地文件夹对应独立云端工作区，
  支持上传、只读下载、冲突副本和手动/自动同步。
- **文档导入与导出**：支持 Markdown、DOCX 和 PDF 导入；Word 转为可编辑
  Markdown 并保留原件，PDF 使用内置阅读器；支持导出 Markdown 和 PDF。
- **写作辅助**：文章脉络、行数/字数/选区统计、查找替换、图片粘贴、
  Ctrl + 滚轮缩放、同步滚动和链接快捷打开。
- **一只懂分寸的橘猫**：平时趴在页边陪写，正式场合可以藏起来。

## 下载与安装

前往 [GitHub Releases](https://github.com/ly20030823/huajian-xinzhi/releases/latest)
下载名字中带有 `x64-setup.exe` 的文件，双击后按安装向导完成安装。

目前主要维护 64 位 Windows 10 / Windows 11。安装版支持在软件内检查、下载
和安装后续更新；便携版需要手动替换。

> 当前安装包尚未使用商业代码签名证书，Windows 可能显示“未知发布者”。
> 请从本仓库 Release 页面下载，并在确认来源后继续安装。

## GitHub 同步不是软件更新

花笺中的 GitHub 多设备同步用于保存你自己的笔记，建议为它单独创建一个
**私有仓库**。本仓库是软件源码和安装包仓库，请不要把个人笔记、访问令牌或
同步数据提交到这里。

## 从源码构建

需要 Node.js、Rust、Microsoft C++ Build Tools 和 Windows WebView2。

```bash
npm install
npm run tauri dev
```

生成 Windows 安装程序：

```bat
build-installer.cmd
```

## 项目来源与许可证

花笺·新枝基于 [Achilng/floral-notepaper](https://github.com/Achilng/floral-notepaper)
继续开发。感谢 Achilng 与所有 Floral Notepaper Contributors 提供原始设计和代码。

本项目遵循 [MIT License](LICENSE)，详细来源说明见 [NOTICE.md](NOTICE.md)。

---

<div align="center">

慢慢写，纸会记得。🌱

</div>
