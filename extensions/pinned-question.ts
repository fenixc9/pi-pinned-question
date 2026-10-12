/**
 * pi-pinned-question
 *
 * Keeps your latest question visible in a sticky bar just above the input
 * editor, so it does not scroll away while the transcript grows.
 *
 * Why "above the editor" and not the very top?
 * Pi's extension API owns two sticky docks (`aboveEditor` / `belowEditor`).
 * The transcript, including any custom header, scrolls. So the closest place
 * to "always visible" that an extension can use is the widget dock directly
 * above the editor.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const WIDGET_KEY = "pinned-question";
export const DEFAULT_MAX_LINES = 3;
export const MAX_MAX_LINES = 10;
export const PIN_MARKER = "📌";
const ELLIPSIS = "…";
const CONTINUATION = "   ";

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for tests)                                   */
/* ------------------------------------------------------------------ */

/** Flatten a user-message content value into plain text. */
export function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (
			block &&
			typeof block === "object" &&
			(block as { type?: unknown }).type === "text" &&
			typeof (block as { text?: unknown }).text === "string"
		) {
			parts.push((block as { text: string }).text);
		}
	}
	return parts.join("\n");
}

/** Find the most recent user message in a session branch. */
export function findLastUserQuestion(entries: readonly unknown[]): string | undefined {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i] as { type?: unknown; message?: { role?: unknown; content?: unknown } } | undefined;
		if (entry?.type !== "message") continue;
		if (entry.message?.role !== "user") continue;
		const text = normalizeQuestion(extractText(entry.message.content));
		if (text) return text;
	}
	return undefined;
}

/** Normalize newlines and trim surrounding whitespace. */
export function normalizeQuestion(raw: string): string {
	return raw.replace(/\r\n?/g, "\n").trim();
}

/**
 * Word-wrap `text` to `width` columns, returning at most `maxLines` lines.
 * When content is truncated, an ellipsis is appended to the last line.
 */
export function wrapToLines(text: string, width: number, maxLines: number): string[] {
	if (width <= 0 || maxLines <= 0) return [];
	const paragraphs = text.split("\n");
	const lines: string[] = [];
	for (const paragraph of paragraphs) {
		if (paragraph.trim().length === 0) {
			if (lines.length > 0) lines.push("");
			continue;
		}
		for (const wrapped of wrapTextWithAnsi(paragraph, width)) {
			lines.push(wrapped);
			if (lines.length > maxLines) break;
		}
		if (lines.length > maxLines) break;
	}
	if (lines.length <= maxLines) return lines;

	const kept = lines.slice(0, maxLines);
	const lastIndex = maxLines - 1;
	const ellipsisWidth = visibleWidth(ELLIPSIS);
	const tail = truncateToWidth(kept[lastIndex] ?? "", Math.max(0, width - ellipsisWidth), "");
	kept[lastIndex] = `${tail}${ELLIPSIS}`;
	return kept;
}

/**
 * Render the pinned bar for a given terminal width.
 * The first line carries the marker; continuation lines are indented to align.
 */
export function renderPinnedLines(
	question: string,
	width: number,
	maxLines: number,
	marker: string = `${PIN_MARKER} `,
): string[] {
	const text = normalizeQuestion(question);
	if (!text || width <= 0 || maxLines <= 0) return [];

	// Terminals narrower than one character cannot show anything useful.
	if (width < 2) return [truncateToWidth(text, width, ELLIPSIS)];

	const markerWidth = visibleWidth(marker);
	// Too narrow for the gutter: render the question without a marker.
	if (width < markerWidth + 2) {
		return capToWidth(wrapToLines(text, width, maxLines), width);
	}

	const contentWidth = Math.max(2, width - markerWidth);
	const body = wrapToLines(text, contentWidth, maxLines);
	if (body.length === 0) return [];
	return capToWidth(
		body.map((line, index) => (index === 0 ? `${marker}${line}` : `${CONTINUATION}${line}`)),
		width,
	);
}

/** Safety net: guarantee every rendered line fits the terminal width. */
function capToWidth(lines: string[], width: number): string[] {
	return lines.map((line) => (visibleWidth(line) <= width ? line : truncateToWidth(line, width, "")));
}

/** Non-TUI fallback used for RPC clients, which ignore component factories. */
export function fallbackLines(question: string, maxLines: number): string[] {
	const text = normalizeQuestion(question);
	if (!text || maxLines <= 0) return [];
	const raw = text.split("\n").filter((line) => line.trim().length > 0);
	const lines = raw.slice(0, maxLines).map((line, index) => (index === 0 ? `${PIN_MARKER} ${line}` : `${CONTINUATION}${line}`));
	if (raw.length > maxLines && lines.length > 0) {
		lines[lines.length - 1] = `${lines[lines.length - 1]} ${ELLIPSIS}`;
	}
	return lines;
}

/* ------------------------------------------------------------------ */
/* TUI component                                                       */
/* ------------------------------------------------------------------ */

export class PinnedQuestionComponent implements Component {
	private question = "";
	private maxLines = DEFAULT_MAX_LINES;
	private cache: { width: number; lines: string[] } | undefined;

	constructor(private readonly theme: Theme) {}

	setState(question: string, maxLines: number): void {
		this.question = question;
		this.maxLines = maxLines;
		this.cache = undefined;
	}

	invalidate(): void {
		this.cache = undefined;
	}

	render(width: number): string[] {
		if (this.cache && this.cache.width === width) return this.cache.lines;
		const marker = `${this.theme.fg("accent", PIN_MARKER)} `;
		const lines = renderPinnedLines(this.question, width, this.maxLines, marker);
		this.cache = { width, lines };
		return lines;
	}
}

/* ------------------------------------------------------------------ */
/* Extension                                                           */
/* ------------------------------------------------------------------ */

export default function pinnedQuestionExtension(pi: ExtensionAPI): void {
	let enabled = true;
	let maxLines = DEFAULT_MAX_LINES;
	let question: string | undefined;
	let component: PinnedQuestionComponent | undefined;
	let activeTui: TUI | undefined;

	const applyWidget = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return;

		const text = question ? normalizeQuestion(question) : "";
		if (!enabled || !text) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			component = undefined;
			return;
		}

		if (ctx.mode === "tui") {
			if (component) {
				component.setState(text, maxLines);
				activeTui?.requestRender();
				return;
			}
			ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
				activeTui = tui;
				const next = new PinnedQuestionComponent(theme);
				next.setState(text, maxLines);
				component = next;
				return next;
			});
			return;
		}

		// RPC and other non-TUI modes: send plain lines (factories are ignored).
		ctx.ui.setWidget(WIDGET_KEY, fallbackLines(text, maxLines));
	};

	const remember = (raw: string): boolean => {
		const text = normalizeQuestion(raw);
		if (!text) return false;
		// Ignore slash commands and inline bash so we only pin real questions.
		if (text.startsWith("/") || text.startsWith("!")) return false;
		question = text;
		return true;
	};

	pi.on("session_start", (_event, ctx) => {
		component = undefined;
		activeTui = undefined;
		const last = findLastUserQuestion(ctx.sessionManager.getBranch());
		if (last) question = last;
		applyWidget(ctx);
	});

	pi.on("input", (event, ctx) => {
		if (event.source === "extension") return;
		if (remember(event.text)) applyWidget(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		component = undefined;
		activeTui = undefined;
	});

	pi.registerCommand("pin", {
		description: "Keep your latest question pinned above the editor (on|off|clear|lines <1-10>).",
		handler: async (args, ctx) => {
			const [subcommand, value] = args.trim().toLowerCase().split(/\s+/);
			switch (subcommand) {
				case "":
				case undefined: {
					enabled = !enabled;
					applyWidget(ctx);
					ctx.ui.notify(`Pinned question: ${enabled ? "on" : "off"}`, "info");
					return;
				}
				case "on":
				case "off": {
					enabled = subcommand === "on";
					applyWidget(ctx);
					ctx.ui.notify(`Pinned question: ${enabled ? "on" : "off"}`, "info");
					return;
				}
				case "clear": {
					question = undefined;
					applyWidget(ctx);
					ctx.ui.notify("Pinned question cleared", "info");
					return;
				}
				case "lines": {
					const parsed = Number.parseInt(value ?? "", 10);
					if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_MAX_LINES) {
						ctx.ui.notify(`Usage: /pin lines <1-${MAX_MAX_LINES}>`, "error");
						return;
					}
					maxLines = parsed;
					applyWidget(ctx);
					ctx.ui.notify(`Pinned question lines: ${maxLines}`, "info");
					return;
				}
				default: {
					ctx.ui.notify("Usage: /pin [on|off|clear|lines <1-10>]", "error");
				}
			}
		},
	});
}