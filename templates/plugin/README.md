# __NAME__

__DESCRIPTION__

```powershell
npm run dev -- __ID__        # rebuild + copy into the vault on every save
npm test -- __ID__
npm run deploy -- __ID__
```

## Layout

```
src/main.ts    plugin wiring (commands, settings, events)
src/core.ts    pure logic, tested without Obsidian
tests/         node --test
```
