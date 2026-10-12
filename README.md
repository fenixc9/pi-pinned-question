# pi-pinned-question

Keep your **latest question** pinned in a sticky bar so it never scrolls away while the answer streams in — built for [Pi](https://github.com/earendil-works/pi).

```
┌──────────────────────────────────────────────┐
│  transcript … (scrolls, long answers, tools)  │
│  …                                            │
├──────────────────────────────────────────────┤
│  📌 Why is my build failing on CI?            │  ← sticky, always visible
│     Did the cache step change?                │
│  ┌────────────────────────────────────────┐  │
│  │ > type your next message…               │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

When you are deep in a long transcript, it is easy to lose track of what you actually asked. This extension captures each new question and renders the most recent one in the widget dock directly above the input editor, where it stays put.

## Install

### As a Pi package (recommended)

```bash
# directly from git
pi install git:github.com/fenixc9/pi-pinned-question

# try it for a single run without installing
pi -e git:github.com/fenixc9/pi-pinned-question
```

### From a local checkout

```bash
git clone https://github.com/fenixc9/pi-pinned-question
pi install /path/to/pi-pinned-question
```

### One-off, single file

```bash
pi --extension /path/to/pi-pinned-question/extensions/pinned-question.ts
```

## Usage

Just ask questions. The bar updates automatically. On session start it restores the last question from the session branch.

| Command | Effect |
| --- | --- |
| `/pin` | Toggle the pinned bar on/off |
| `/pin on` \| `/pin off` | Explicitly enable or disable |
| `/pin lines <1-10>` | Maximum number of lines to show (default `3`) |
| `/pin clear` | Clear the pinned question |

Slash commands and inline bash (`!…`) are intentionally ignored, so they never get pinned.

## How it works

- On every `input` event (except from other extensions, commands, and bash), the question is stored.
- On `session_start`, the last user message is reconstructed from `ctx.sessionManager.getBranch()`.
- The text is rendered as a width-aware TUI component using Pi's own `wrapTextWithAnsi` / `visibleWidth`, so CJK and emoji are measured correctly.
- In RPC mode, where component factories are ignored, it falls back to plain `string[]` widget lines.

## Limitation: "above the editor", not the very top

Pi's extension API exposes two sticky widget docks: `aboveEditor` and `belowEditor`. The transcript — including any custom header set via `setHeader()` — lives inside the scrollable region, so it scrolls away. There is no top-dock API for extensions.

This extension therefore docks **directly above the input editor**, which is the closest position to "always visible" an extension can occupy. If Pi adds a top dock, this extension can adopt it.

## Development

```bash
npm install

npm run typecheck   # tsc --noEmit
npm test            # unit tests (node:test + tsx)
npm run check       # typecheck + tests
npm run smoke       # real `pi --mode rpc` end-to-end assertion
```

The smoke test spawns a real Pi process, sends a prompt, and asserts that the extension emits a `setWidget` UI request. It needs `pi` on `PATH` (override with `PI_BIN`). Set `SMOKE_TARGET=.` to exercise the package manifest instead of the single file.

## 中文说明

在很长的对话里，你最初的问题很容易被淹没。这个扩展会把**最近一次提问**固定显示在输入框上方的粘性区域，随时可见。

- 自动捕获每次提问，也可在会话开始时从历史记录恢复。
- `/pin` 开关，`/pin lines <1-10>` 调整行数，`/pin clear` 清除。
- 使用 Pi 自带的宽度计算，中文、emoji 都能正确换行。

> 注意：Pi 扩展接口只提供 `aboveEditor` / `belowEditor` 两个粘性 dock，没有"屏幕最顶部"的 dock。因此它固定在**输入框上方**，这是扩展能做到的最接近"始终可见"的位置。

## License

MIT © 2026 fenixc9