# Documentation map

Where each piece of documentation lives, who it is for, and when to update it. Every change updates the docs in the
same commit as the code: docs that drift are worse than no docs.

```mermaid
flowchart TB
  readme[README.md<br/>repo overview, commands] --> claude[CLAUDE.md<br/>rules for Claude: conventions, safety, done]
  claude --> workflow[docs/workflow.md<br/>playbooks]
  claude --> style[docs/code-style.md<br/>best practices, review checklist]
  claude --> testing[docs/testing.md<br/>unit + smoke tests]
  claude --> api[docs/obsidian-api.md<br/>API notes, traps]
  readme --> plugin[plugins/id/README.md<br/>overview, install]
  plugin --> guide[plugins/id/docs/user-guide.md<br/>users]
  plugin --> arch[plugins/id/docs/architecture.md<br/>developers]
  plugin --> pclaude[plugins/id/CLAUDE.md<br/>invariants, tests, limits]
  plugin --> extra[plugins/id/docs/*.md<br/>specs, e.g. format.md]
```

## Repo level (all plugins)

| Document | For | Holds |
|---|---|---|
| `README.md` | Owner, newcomers | What the repo is, the plugin list, commands, layout |
| `CLAUDE.md` | Claude Code | Conventions, safety rules, definition of done; read first |
| `docs/workflow.md` | Developers, Claude | Playbooks: new plugin, improve a plugin, debugging, release, code review |
| `docs/code-style.md` | Developers, Claude | Best practices (KISS, DRY, comments, errors) and the review checklist |
| `docs/testing.md` | Developers, Claude | Unit tests and the in-app smoke test contract |
| `docs/obsidian-api.md` | Developers, Claude | Obsidian API building blocks, internal APIs relied on, traps already hit |

## Plugin level (`plugins/<id>/`)

| Document | For | Holds |
|---|---|---|
| `README.md` | Users | One-paragraph pitch, what you can do, install, develop, document table, source layout |
| `docs/user-guide.md` | Users | Every feature, command and setting, limits and troubleshooting |
| `docs/architecture.md` | Developers | Layers, data storage, main flows (Mermaid), module reference |
| `docs/<topic>.md` | Developers, other apps | Specs that outlive the code, e.g. a storage format |
| `CLAUDE.md` | Claude | What it does in short, where to change what, invariants, tests, guidelines audit, known limits |

## When to update what

| You changed | Update |
|---|---|
| Something a user sees (command, menu, setting, behaviour, limit) | the plugin's `docs/user-guide.md`; its README list if it is a headline feature |
| A module's role, a flow, a new module | the plugin's `docs/architecture.md` (module reference, diagrams) and the README layout |
| A stored format | the plugin's `docs/<format>.md` |
| An invariant, a test file, a known limit | the plugin's `CLAUDE.md` |
| Tooling, conventions, a new trap | root `CLAUDE.md`, `docs/*.md` |

Rules: diagrams in **Mermaid** only; one fact in one place (link to it rather than copying it); no counts or dates that
silently go stale unless they are labelled (`~140 checks`, `audited on 2026-11-20`).
