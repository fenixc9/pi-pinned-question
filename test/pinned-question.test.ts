import assert from "node:assert/strict";
import { test } from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import pinnedQuestionExtension, {
	DEFAULT_MAX_LINES,
	PinnedQuestionComponent,
	WIDGET_KEY,
	extractText,
	fallbackLines,
	findLastUserQuestion,
	normalizeQuestion,
	renderPinnedLines,
	wrapToLines,
} from "../extensions/pinned-question.ts";

/* ---------------------------- extractText ---------------------------- */

test("extractText handles strings and text blocks", () => {
	assert.equal(extractText("hello"), "hello");
	assert.equal(
		extractText([
			{ type: "text", text: "line 1" },
			{ type: "image", data: "xxx", mimeType: "image/png" },
			{ type: "text", text: "line 2" },
		]),
		"line 1\nline 2",
	);
	assert.equal(extractText(undefined), "");
	assert.equal(extractText([{ type: "image" }]), "");
});

/* ---------------------- findLastUserQuestion ------------------------ */

test("findLastUserQuestion returns the most recent user message", () => {
	const entries = [
		{ type: "message", message: { role: "user", content: "first" } },
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "reply" }] } },
		{ type: "model_change", provider: "x", modelId: "y" },
		{ type: "message", message: { role: "user", content: [{ type: "text", text: "second" }] } },
		{ type: "message", message: { role: "assistant", content: "still replying" } },
	];
	assert.equal(findLastUserQuestion(entries), "second");
	assert.equal(findLastUserQuestion([]), undefined);
});

test("findLastUserQuestion skips empty user messages", () => {
	const entries = [
		{ type: "message", message: { role: "user", content: "real question" } },
		{ type: "message", message: { role: "user", content: "   " } },
	];
	assert.equal(findLastUserQuestion(entries), "real question");
});

/* ------------------------- wrapToLines ------------------------------ */

test("wrapToLines respects the line budget and adds an ellipsis", () => {
	const text = "one two three four five six seven eight nine ten eleven twelve";
	const lines = wrapToLines(text, 20, 2);
	assert.equal(lines.length, 2);
	assert.ok(lines[1]!.endsWith("…"), `expected ellipsis, got: ${JSON.stringify(lines)}`);
	for (const line of lines) assert.ok(visibleWidth(line) <= 20);
});

test("wrapToLines keeps everything when it fits", () => {
	const lines = wrapToLines("short question", 40, 3);
	assert.deepEqual(lines, ["short question"]);
});

test("wrapToLines handles CJK width correctly", () => {
	const text = "这是一个很长的问题需要换行显示";
	const width = 12;
	const lines = wrapToLines(text, width, 5);
	assert.ok(lines.length > 1, "expected CJK text to wrap");
	for (const line of lines) assert.ok(visibleWidth(line) <= width, `line too wide: ${JSON.stringify(line)}`);
});

test("wrapToLines returns nothing for degenerate inputs", () => {
	assert.deepEqual(wrapToLines("hi", 0, 3), []);
	assert.deepEqual(wrapToLines("hi", 10, 0), []);
});

/* ----------------------- renderPinnedLines -------------------------- */

test("renderPinnedLines puts the marker on the first line only", () => {
	const lines = renderPinnedLines("a question about sticky headers", 30, 3);
	assert.ok(lines.length >= 2);
	assert.ok(lines[0]!.startsWith("📌"));
	for (let i = 1; i < lines.length; i += 1) {
		assert.ok(!lines[i]!.startsWith("📌"), "continuation lines must not repeat the marker");
		assert.ok(lines[i]!.startsWith("   "), "continuation lines should align under the text");
	}
});

test("renderPinnedLines never exceeds the requested width", () => {
	const widths = [4, 8, 12, 24, 40, 80];
	for (const width of widths) {
		const lines = renderPinnedLines("这是一个用于测试的较长问题 with mixed 中文 and english words", width, 3);
		for (const line of lines) {
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)} (${visibleWidth(line)})`);
		}
	}
});

test("renderPinnedLines honors the marker and max lines", () => {
	const lines = renderPinnedLines("hello world", 40, 1, "> ");
	assert.equal(lines.length, 1);
	assert.equal(lines[0], "> hello world");
	assert.deepEqual(renderPinnedLines("   ", 40, 3), []);
});

/* ------------------------- fallbackLines ---------------------------- */

test("fallbackLines emits plain RPC-safe lines", () => {
	const lines = fallbackLines("alpha\nbeta\ngamma", 2);
	assert.equal(lines.length, 2);
	assert.equal(lines[0], "📌 alpha");
	assert.equal(lines[1], "   beta …");
});

/* ------------------------- component -------------------------------- */

test("PinnedQuestionComponent renders, caches, and updates", () => {
	const theme = { fg: (_color: string, text: string) => text } as never;
	const component = new PinnedQuestionComponent(theme);
	component.setState("what is the meaning of life", DEFAULT_MAX_LINES);

	const first = component.render(30);
	const second = component.render(30);
	assert.equal(first, second, "same width should reuse cached lines");
	assert.ok(first[0]!.includes("meaning of life"));

	component.setState("a different question", DEFAULT_MAX_LINES);
	const updated = component.render(30);
	assert.ok(updated.join(" ").includes("different"));
});

/* -------------------- extension wiring (mocked) --------------------- */

type FakeHandler = (event: unknown, ctx: unknown) => unknown;

function createHarness(mode: "tui" | "rpc" = "tui") {
	const handlers = new Map<string, FakeHandler>();
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => unknown }>();
	const widgets: Array<{ key: string; content: unknown }> = [];
	const notifications: string[] = [];
	const branch: unknown[] = [];

	const ui = {
		setWidget(key: string, content: unknown) {
			widgets.push({ key, content });
		},
		notify(message: string) {
			notifications.push(message);
		},
		theme: { fg: (_color: string, text: string) => text },
	};

	const ctx = {
		hasUI: true,
		mode,
		ui,
		sessionManager: { getBranch: () => branch },
	};

	const api = {
		on(type: string, handler: FakeHandler) {
			handlers.set(type, handler);
		},
		registerCommand(name: string, options: { handler: (args: string, ctx: unknown) => unknown }) {
			commands.set(name, options);
		},
	};

	pinnedQuestionExtension(api as never);

	return { handlers, commands, widgets, notifications, ui, ctx, branch };
}

test("extension hides the widget until a question is asked", () => {
	const { handlers, widgets, ctx } = createHarness();
	handlers.get("session_start")?.({}, ctx);
	assert.equal(widgets.at(-1)?.content, undefined);
});

test("extension pins the latest question as a TUI component", () => {
	const { handlers, widgets, ctx } = createHarness("tui");
	handlers.get("session_start")?.({}, ctx);
	handlers.get("input")?.({ type: "input", source: "interactive", text: "how do I center a div?" }, ctx);

	const widget = widgets.at(-1);
	assert.equal(widget?.key, WIDGET_KEY);
	assert.equal(typeof widget?.content, "function", "TUI mode should use a component factory");

	const factory = widget?.content as (tui: unknown, theme: unknown) => PinnedQuestionComponent;
	const component = factory({ requestRender() {} }, { fg: (_color: string, text: string) => text });
	const lines = component.render(40);
	assert.ok(lines[0]!.includes("center a div"), lines.join("\n"));
});

test("extension ignores slash commands", () => {
	const { handlers, widgets, ctx } = createHarness("tui");
	handlers.get("session_start")?.({}, ctx);
	const before = widgets.at(-1);
	handlers.get("input")?.({ type: "input", source: "interactive", text: "/help" }, ctx);
	assert.equal(widgets.at(-1), before, "slash commands should not touch the widget");
});

test("extension uses plain lines in RPC mode", () => {
	const { handlers, widgets, ctx } = createHarness("rpc");
	handlers.get("session_start")?.({}, ctx);
	handlers.get("input")?.({ type: "input", source: "rpc", text: "rpc question" }, ctx);
	const widget = widgets.at(-1);
	assert.ok(Array.isArray(widget?.content), "RPC mode should send a string array");
	assert.ok((widget?.content as string[])[0]!.includes("rpc question"));
});

test("extension restores the last question from the session branch", () => {
	const { handlers, widgets, ctx, branch } = createHarness("rpc");
	branch.push(
		{ type: "message", message: { role: "user", content: "restored question" } },
		{ type: "message", message: { role: "assistant", content: "reply" } },
	);
	handlers.get("session_start")?.({}, ctx);
	const widget = widgets.at(-1);
	assert.ok((widget?.content as string[])[0]!.includes("restored question"));
});

test("/pin toggles, clears, and validates line counts", () => {
	const { handlers, commands, widgets, notifications, ctx } = createHarness("rpc");
	handlers.get("session_start")?.({}, ctx);
	handlers.get("input")?.({ type: "input", source: "rpc", text: "keep me" }, ctx);

	const pin = commands.get("pin");
	assert.ok(pin, "expected the /pin command to be registered");

	pin.handler("off", ctx);
	assert.equal(widgets.at(-1)?.content, undefined);
	assert.ok(notifications.some((n) => n.includes("off")));

	pin.handler("on", ctx);
	assert.ok(Array.isArray(widgets.at(-1)?.content));

	pin.handler("lines 99", ctx);
	assert.ok(notifications.some((n) => n.includes("Usage")));

	pin.handler("lines 5", ctx);
	assert.ok(notifications.some((n) => n.includes("lines: 5")));

	pin.handler("clear", ctx);
	assert.equal(widgets.at(-1)?.content, undefined);
});

/* --------------------------- normalize ------------------------------ */

test("normalizeQuestion trims and normalizes newlines", () => {
	assert.equal(normalizeQuestion("  a\r\nb\r  "), "a\nb");
});