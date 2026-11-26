---
name: lia-cli-shape
description: Decide what kind of user-facing control to build in lia and what to call it, and check a change against the agreed shape. Covers top-level commands, subcommands, arguments, flags, settings keys in settings.json and .lia.json, LIA_ env vars, JSON output, and exit codes. Use when adding, renaming, deprecating, removing, or reviewing one, such as "add a command", "subcommand or flag?", "flag or setting?", "new env var", "make this configurable", "what should this be called", or a diff that touches src/builtins/commands.zig, src/core/cli/, src/core/config/, or adds an LIA_ env read. Not for writing documentation prose.
---

# lia CLI shape

This skill tells you which kind of control to build and what to call it. lia follows the shape that git, gh, docker, and the Vercel CLI share, so people who know those tools can guess lia's commands. Follow these rules unless a maintainer says otherwise in the conversation.

## The shape of a command

```
lia  session  fork    last --json
     group    verb    argument flag

lia  ask      "fix the login bug"  --model <id>
     verb     argument             flag
```

| Part | Job | Lasts | Example |
|---|---|---|---|
| Top-level command | A main job, or a group of jobs on one thing | One run | `lia ask`, `lia session` |
| Subcommand | One job on the group's thing | One run | `lia session fork`, `lia mcp add` |
| Argument | What the job works on | One run | `<id>`, `<name>`, `<path>` |
| Flag | How this run works: scope, amount, filter, or format | One run | `--all`, `--limit 20`, `--json` |
| Setting | A choice lia remembers | Until changed | `fast_mode` in `~/.lia/settings.json` |
| Env var | Context from CI, a wrapper, the terminal, debugging, or tests | The process | `LIA_TRACE=1` |

## Ways into lia

lia has no interactive session: plain `lia` prints its help and exits 0, and a first word that is no command exits 2 with a hint.

| Way in | What it does | Takes |
|---|---|---|
| `lia ask "<prompt>"` | Runs one request and exits. Scripts use this; `--resume <last\|id>` continues a saved session | The agent-run set, plus `--json`, `--timeout`, and `--config key=value` |
| `lia acp` | Serves an editor over ACP | The agent-run set without the 2 provider-order flags, which do nothing in ACP |
| `lia pr`, `lia issue` | Runs the agent on a pull request or an issue | The agent-run set |
| Every other command | Does one job without the agent, such as `lia status` | Only its own flags |

A flag goes in one of 2 places:

- **Launch-wide flags go before the command**, because they shape the whole launch, as in `git -C dir log`: `--add-dir`, `--no-additional-dirs`, `--context-limit`, and `--tool-placement`.
- **Agent-run flags go after the command**: `--model`, `--provider`, `--effort`, `--fast`, `--ultrafast`, `--provider-order`, `--provider-strict`, and `--permission-mode`. Every way in that runs the agent takes the whole set, so a new agent-run flag is added to the set once and works everywhere.

A new way in is a new top-level command, and it takes the whole agent-run set.

## Pick the mechanism

Ask in order, and stop at the first yes:

1. Is it a job people do? Make it a subcommand of the group for that thing.
2. Is it the thing the job works on? Make it an argument.
3. Is it a secret? Use the credential store through `lia login`, with an env var only for CI. Never a flag, which shows in `ps` and shell history, and never `.lia.json`.
4. Does it change how one run works? Make it a flag.
5. Should lia remember it? Make it a setting, plus a flag with the same name for one run.
6. Should a team share it, and is it safe when an untrusted repo sets it? It may also go in `.lia.json`, with a maintainer's approval.
7. Does it come from CI, a wrapper, the terminal, debugging, or tests? Make it an env var. An env var for a setting uses the setting's name, as `LIA_MODEL` pins the model for a whole CI job.
8. Is it unfinished? Make it an `experimental.<name>` setting.

### Subcommand or flag

A different job is a subcommand. The same job done another way is a flag.

| You want | Build | Why |
|---|---|---|
| List the saved sessions | `lia sessions ls` | A job on sessions |
| List sessions from every workspace | `lia sessions ls --all` | Same job, wider scope |
| Get the list as JSON | `lia sessions ls --json` | Same job, other format |
| Copy one session | `lia session fork <id>` | Another job on one session |
| Pick one of several values | `lia usage --period <today\|7d\|month>` | One flag takes the value |

Wrong shapes, with made-up examples:

- A flag that does a job: `lia session --delete <id>`. Make it `lia session remove <id>`.
- A subcommand that only changes format, scope, or amount: `lia sessions list-json`. Make it a flag.
- One flag per value: `--today`, `--week`, `--month`. Make one flag that takes the value.
- A value in a flag's name: `--resume-<id>`. Make it `--resume <id>`.

### Top-level command or subcommand

When the job acts on a thing that already has a group, make it a subcommand. That is almost always the answer.

A new top-level command needs a maintainer's approval, and one of these must be true:

- It is a main job that people start often and that belongs to no group, like `lia ask` and `lia login`.
- It is a new kind of thing with 2 or more jobs, so it becomes a group, like `lia workspace` with `list`, `add`, `remove`, and `clear`.

A thing with 1 job is a plain command with flags. First check whether a flag on an existing command covers the need, such as a scope flag on `lia usage` instead of a new `lia stats`.

## Name it

- **Groups use the singular noun**: `lia session`, `lia workspace`, `lia config`, as in `docker container` and `gh pr`. Where people already type the plural, it stays: `lia sessions`, `lia models`.
- **Every group uses the same verbs**: `list`, `show`, `add`, `remove`, `get`, `set`, `unset`, `clear`. The short Unix word works too: `ls` for `list`, `rm` for `remove`. gh, docker, and the Vercel CLI accept both.
- **A bare group runs its list** when listing changes nothing: `lia config` runs `lia config list`, and `lia sessions` runs `lia sessions ls`.
- **One concept has one name on every surface**, and only the case changes:

| Surface | Case | Example |
|---|---|---|
| Setting key and JSON field | snake_case | `permission_mode` |
| Flag | kebab-case | `--permission-mode` |
| Env var | `LIA_` plus upper snake case | `LIA_PERMISSION_MODE` |

A flag or env var for a setting takes the setting's name: `session_titles` gets `--session-titles`, `--no-session-titles`, and `LIA_SESSION_TITLES`, never `--no-titles`. Read [references/decided-names.md](references/decided-names.md) before you name anything, and reuse what is there.

## Rules agents get wrong

- **Run flags never save, and setter commands do.** `lia ask --model <id>` changes only that run. A command whose whole job is to change something saves it and prints one line that names the value and the file: `lia config set fast_mode on` prints `fast_mode set to true in ~/.lia/settings.json.` Others are `lia provider gateway`, `lia login`, and `lia teams`. `lia config set` refuses the model keys; the default model is an edit to `~/.lia/settings.json`.
- **Flag syntax.** `--x value` and `--x=value` both work, a boolean pairs `--x` with `--no-x`, and when flags repeat or conflict the last one wins.
- **Env vars carry context, not preferences.** To change a setting for one `lia ask` run, use `--config key=value`.
- **Output.** Results go to stdout and diagnostics to stderr. A command that prints data takes `--json`, and its fields are only added; commands such as `lia status --json` name their shape with `kind`, never a `schema_version`. Exit 0 means success, 1 means the work failed, and 2 means the command line is wrong.
- **Renames never break users.** The old name keeps working for at least 2 releases and 30 days, with a warning built from `command_specs.deprecated_until` that names its replacement and `old_spelling_removal` (0.2.0 for the current set).

[references/rules.md](references/rules.md) has these rules in full, and the rest: experiments, precedence, scopes, and error text.

## Built today and planned

Design toward the planned shape, but never tell a user to run something that does not exist. When unsure, run `./zig-out/bin/lia <command> --help`.

| Planned | Today |
|---|---|
| One `lia session` group, also reached as `lia sessions` | 2 groups: `lia session` reads, forks, and recovers one session, and `lia sessions` lists and converts |
| `lia model`, also reached as `lia models` | Only `lia models` |
| `ls` and `rm` in every group, declared in the command specs | `ls` only in `lia sessions` and `lia models`, through a hand-written check. `list` only in `lia config`, `lia mcp`, and `lia workspace` |

## Workflow

1. List every control the change adds, renames, or removes. For a diff, run [scripts/surface_diff.sh](scripts/surface_diff.sh) from the repo root.
2. Walk each one through "Pick the mechanism", and name it from an existing name: search `src/core/config/settings_keys.zig`, `src/builtins/commands.zig`, and decided-names.md.
3. Check it against its section in [references/rules.md](references/rules.md).
4. Find the files to change and the traps in [references/implementation.md](references/implementation.md).
5. Run `python3 -m scripts.check_cli_shape`, the shape check CI runs.
6. Report any conflict or needed approval first. Then give each control, its mechanism, its name on each surface, the rule behind each choice, and what is not built yet.

When a request breaks a rule, say so first: name the rule, give its reason, and offer the version that follows the rules. Build the requested version only if a maintainer approves the exception. When you review a diff, report shape problems next to bugs.

## Stop and ask a maintainer

Ask before you:

- add a top-level command, a stable env var, or a project-safe setting;
- rename or remove a stable control: `lia ask --json` fields, ACP behavior, or stable env vars;
- make an exception to these rules;
- invent a rule for something they do not cover, such as `--quiet`, `--verbose`, `--dry-run`, signals, or file-write safety.

When the rules do not cover a case, copy an open standard first, such as `AGENTS.md`, MCP's `mcp.json`, or `NO_COLOR`, then git, gh, and docker, and then ask.

## References

- [references/rules.md](references/rules.md): every rule by mechanism, with what is built.
- [references/decided-names.md](references/decided-names.md): names already settled.
- [references/implementation.md](references/implementation.md): where each control lives in the code, and the traps.
- [scripts/surface_diff.sh](scripts/surface_diff.sh): the controls a diff adds or removes. Run it with `--help`.
