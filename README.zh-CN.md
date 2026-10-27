# pi-agents-md-context

[English](README.md) | 简体中文

[![CI](https://github.com/Maizify/pi-agents-md-context/actions/workflows/ci.yml/badge.svg)](https://github.com/Maizify/pi-agents-md-context/actions/workflows/ci.yml)

Pi 的嵌套 `AGENTS.md` 上下文加载器，按**可见**会话投影去重。

Pi 自身只加载工作目录及其祖先目录的 context file，子目录里的不会加载。本扩展在 agent 读取某个文件时，把这些子目录的 `AGENTS.md` 追加进该次读取结果。

## 安装

```bash
pi install npm:pi-agents-md-context   # 全局，发布后可用
pi install ./path/to/pi-agents-md-context
pi -e ./path/to/pi-agents-md-context  # 单次试用，不改配置
```

## 做了什么

读取 `packages/web/src/server.ts` 时，把该目录到工作目录之间的每一层 context file 追加进来，由根到叶排序：

```
packages/AGENTS.md
packages/web/AGENTS.md
packages/web/src/AGENTS.md   （若存在）
```

文件名优先级与 Pi 一致：`AGENTS.override.md` > `AGENTS.md` > `CLAUDE.md`，每个目录只取一个。

## 为什么再造一个

市面上的嵌套上下文加载器，多数把去重状态放在进程内存缓存里。这带来两个问题：重启后恢复会话会重复注入同样的文本（而且反复叠加）；上下文压缩丢掉承载注入的消息后，规则不会再回来。

本扩展把已注入文件的记录写进读取结果的 `details`，随消息一起持久化，并从 `sessionManager.buildSessionContext()` 重建状态 —— 也就是真正发给模型的、压缩感知的投影。

| 场景 | 进程内缓存 | 本扩展 |
|---|---|---|
| 重启后恢复会话 | 再次注入（重复） | 不重复 |
| 压缩丢掉了读取结果 | 永不恢复（丢失） | 下次读取时重新加载 |
| 磁盘上 `AGENTS.md` 被修改 | 只能开新会话 | 内容变化时重新注入 |
| 连续两次读同一文件 | 不重复 | 不重复 |

## 行为细节

- 成功的 `read`、`edit`、`write` 结果会触发：文件正文或对它的改动已经进了对话。
- `bash` 里真正读文件内容的命令同样触发：`cat`、`sed`（非 `-i`）、`head`、`tail`、`bat`、`less`、`awk`。Pi 的 agent 用这些的频率和 `read` 相当，属于同一读取通道。
- `cd` 只用于决定后续相对路径的基准目录，本身不加载任何东西。`ls`、`grep`、`find` 等探索命令永不触发。
- 每次工具结果最多追加 2 个 context file，避免一条 `cat a b c` 把上下文灌满。
- 工作目录之外的目标一律忽略；工作目录以上的祖先链由 Pi 自己负责。
- 按内容哈希判断：未变化的文件不再注入，变化的重新注入。
- 直接读取或写入 context file 本身时只记录、不回贴内容。
- 注入落在工具结果里、不进 system prompt，作为工具输出之后的独立文本块：Pi 自己的 `Project-specific instructions and guidelines:` 前言 + `<project_instructions path="…">` 包裹。模型按读系统提示里那些 context file 的同一方式理解，也能看出这是另加载的指令、不属于上面那个文件的内容。
- 因为仍是工具结果，它依然会被压缩掉；必须扛过压缩的硬约束，应写在根 `AGENTS.md` 或 `.pi/APPEND_SYSTEM.md`。
- 只做搜索的工作流（`grep`、`rg`、`ls`、`find`）不加载任何东西；第一次真正读文件时才注入，无论走 `read` 还是 `cat`/`sed`。
- shell 写文件（`sed -i`、`tee`、重定向）不识别；写入路径靠 `edit`、`write`。

## 源码结构

```
src/projection.ts   rebuiltState(messages)   纯函数：可见记录 → known map
src/attachments.ts  planAttachments(input)   纯函数：一个文件 → 待追加列表
src/bashReads.ts    bashReadTargets(cmd, cwd) 纯函数：shell 命令 → 它读了哪些文件
src/index.ts        事件绑定（session_start / session_compact / tool_result）
```

两个纯函数由 `node --test` 覆盖，测试过程不启动 Pi 进程。

```bash
npm install
npm test
npm run typecheck
```

## 许可

MIT
