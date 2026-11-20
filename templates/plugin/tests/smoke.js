// In-app smoke test, run by `npm run smoke -- __ID__` inside a throwaway Obsidian (never your vault).
// Available: app, plugin (this plugin's instance), check(name, cond, detail), sleep(ms), expectError(regex).
// Vault: tests/fixtures/vault if it exists, else a single Welcome.md. Contract: docs/testing.md at the repo root.

check("plugin instance", !!plugin);
check("command registered", !!app.commands.commands["__ID__:say-hello"]);

app.commands.executeCommandById("__ID__:say-hello");
await sleep(300);
check("notice shown", [...document.querySelectorAll(".notice")].some((n) => n.textContent.includes("Hello")));
