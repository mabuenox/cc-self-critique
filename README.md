# cc-self-critique

A [Claude Code](https://claude.com/claude-code) mod that adds an **Autocrítica** (self-critique) pane. Each time Claude finishes a turn, the mod asks the same model, over the same conversation, to review what it just did and shows the answer beside the chat.

> The reflections are written in Spanish. To change the language, edit the prompt in `hooks/register.tsx`.

## What each reflection covers

Every reflection has eight sections, each tagged with a severity (`ninguna`, `leve` or `importante`):

| Section | What it answers |
| --- | --- |
| Decisiones y proceso | What Claude decided and how it got there |
| Inferencias y asunciones | What it took for granted, and why it didn't ask |
| Qué debí preguntarte | The concrete questions it should have asked you first |
| Huecos rellenados | Data or information it made up or assumed |
| Incoherencias | Contradictions, mistakes, or tool errors it ignored |
| Alternativas no exploradas | Paths that might have been worth trying |
| Qué eché en falta | What was missing from you, the tools or the resources |
| Skills y plugins que influyeron | Skills, plugins, hooks or injected context that steered the answer |

## Features

- **Severity colours.** Each section title is grey, yellow or red. Sections with nothing to report collapse to their title, and a toast appears when any section is `importante`.
- **"Pásaselo a Claude" button.** Fills the prompt, without sending it, with the sections that found something, plus a request to fix them and ask the pending questions. You review it before you send it.
- **Facts, not just memory.** The mod records the turn's tool calls (ok, error with its text, or denied with the reason), the skills invoked, and any context a hook injected after a tool. All of that is passed to the reflection.
- **Cost visible.** Each entry shows the input, output and cached tokens it used.
- **Modes.** Choose when it reflects; the choice is kept across sessions.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install autocritica --marketplace mabuenox/cc-self-critique
```

Answer `y` to add the marketplace, then pick a scope (user scope is the first option).

From a shell:

```
claude plugin install autocritica --marketplace mabuenox/cc-self-critique
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `mabuenox/cc-self-critique`, then **Add plugin**.

## Usage

The pane opens when the session starts and docks beside the transcript in fullscreen layouts from 110 columns wide; narrower, it sits above the prompt.

| Command | Effect |
| --- | --- |
| `/autocritica` | Reopen the pane |
| `/autocritica on` | Reflect after every answered turn (default) |
| `/autocritica herramientas` | Reflect only after turns that called a tool |
| `/autocritica off` | Stop reflecting |

The pane keeps the last 10 reflections, newest first. While one is being written it shows `reflexionando…`; if it fails, it shows the reason (for example `api-error 529 (overloaded)`).

## How it works

- On `turn.complete` of the main conversation (subagent turns, interrupted turns and errors are skipped), the mod schedules a timer so the turn ends at once. Then it calls `$.model.fork`, a tool-less completion over the session's own transcript, which reuses the prompt cache. That way the critique comes from the model that took the turn, with its real context.
- The prompt includes the turn's final answer and the tool log, and asks for the eight sections above in at most 400 words, writing "Ninguna" rather than inventing criticism.
- Only one reflection runs at a time. A turn that ends while one is still running is skipped, and a reflection stuck for more than 3 minutes stops blocking the next ones.

## Cost

**Every reflected turn makes one extra model call** at the session's model and effort level. Most of the conversation is read from the prompt cache, but the reflection's output (up to about 400 words) is billed in full. Use `/autocritica herramientas` or `/autocritica off` to cut it down.

## Limitations

- Context injected at session start or on prompt submit (`SessionStart`, `UserPromptSubmit` hooks) is not in the tool log; the model only sees it because it is already in the conversation.
- A turn that ends while the mod reloads (for example, while you edit it) gets no reflection.
- The critique is the model's own view of its turn. It can miss things or be wrong, so treat it as a prompt for review, not as a verdict.

## Development

```
claude --plugin-dir .         # run a session with the mod loaded from this folder
claude plugin validate .      # check the manifest and hooks module
claude plugin test .          # run tests/autocritica.test.tsx
npx tsc -p .                  # type-check (after the mod has loaded once, which writes .claude-plugin/types/)
```

| Path | Contents |
| --- | --- |
| `hooks/register.tsx` | The hooks module: pane, command, turn and tool hooks, the prompt |
| `types/index.d.ts` | The `$.state` contract: reflections and mode |
| `tests/autocritica.test.tsx` | Section parsing, follow-up text, pane drawing and the button |
| `.claude-plugin/marketplace.json` | Makes this repository installable as a marketplace |

## License

[MIT](LICENSE)
