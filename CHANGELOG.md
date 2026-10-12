# Changelog

## v0.1.0

Initial release.

- Pin the latest user question in a sticky widget directly above the input editor.
- Capture questions from Pi's `input` event; ignore slash commands and inline bash.
- Restore the last question from the session branch on `session_start`.
- Width-aware TUI rendering (CJK / emoji safe) with a plain-line fallback for RPC mode.
- `/pin` command: toggle on/off, `clear`, and `lines <1-10>`.