// Pure logic, no "obsidian" import, so tests/ can run it with node --test.

export function greeting(name: string): string {
  return `Hello, ${name.trim() || "world"}!`;
}
