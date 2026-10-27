# pi-agents-md-context

[English](README.md) | 简体中文

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

已有四个包在做嵌套 `AGENTS.md` 注入，但都把去重状态放在进程内存缓存里。这带来两个问题：重启后恢复会话会重复注入同样的文本（而且反复叠加）；上下文压缩丢掉承载注入的消息后，规则不会再回来。

本扩展把已注入文件的记录写进读取结果的 `details`，随消息一起持久化，并从 `sessionManager.buildSessionContext()` 重建状态 —— 也就是真正发给模型的、压缩感知的投影。

| 场景 | 进程内缓存 | 本扩展 |
|---|---|---|
| 重启后恢复会话 | 再次注入（重复） | 不重复 |
| 压缩丢掉了读取结果 | 永不恢复（丢失） | 下次读取时重新加载 |
| 磁盘上 `AGENTS.md` 被修改 | 只能开新会话 | 内容变化时重新注入 |
| 连续两次读同一文件 | 不重复 | 不重复 |

## 行为细节

- 只有成功的 `read` 结果会触发；`ls`、`grep`、`glob`、shell 命令都不触发。
- 工作目录之外的目标一律忽略；工作目录以上的祖先链由 Pi 自己负责。
- 按内容哈希判断：未变化的文件不再注入，变化的重新注入。
- 直接读取 context file 本身时只记录、不回贴内容。
- 注入落在工具结果里，不进 system prompt。必须扛过压缩的硬约束，应写在根 `AGENTS.md` 或 `.pi/APPEND_SYSTEM.md`。

## 源码结构

```
src/projection.ts   rebuiltState(messages)   纯函数：可见记录 → known map
src/attachments.ts  planAttachments(input)   纯函数：一次 read → 待追加列表
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
