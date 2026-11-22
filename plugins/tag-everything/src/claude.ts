// Runs a command line program (Claude Code) and collects its output. No `obsidian` import: the `spawn` function
// is passed in (Node's `child_process.spawn`, reached through Electron's `require` in the app), so unit tests run
// it with a real process.

/** The part of Node's `child_process.spawn` used here. */
export type Spawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; windowsHide: boolean; shell: false },
) => ChildLike;

export interface ChildLike {
  stdin: { end(data: string): void; on(event: "error", fn: (err: Error) => void): unknown } | null;
  stdout: { on(event: "data", fn: (chunk: unknown) => void): unknown } | null;
  stderr: { on(event: "data", fn: (chunk: unknown) => void): unknown } | null;
  on(event: "error", fn: (err: Error & { code?: string }) => void): unknown;
  on(event: "close", fn: (code: number | null) => void): unknown;
  kill(): boolean;
}

export interface RunOptions {
  cwd: string;
  /** Written to stdin, then stdin is closed. */
  input: string;
  timeoutMs: number;
  /** Aborting kills the process; the run rejects with "cancelled". */
  signal?: AbortSignal;
}

/** The command was not found: try the next candidate, or tell the user where to set it. */
export class NotFoundError extends Error {}

/**
 * Runs `command args` in `cwd` without a shell (arguments are passed as they are, no quoting issue), writes
 * `input` to its stdin, and resolves to its stdout once it exits with code 0. Rejects with the end of stderr on
 * another code, `NotFoundError` when the command does not exist, and on timeout or cancel (the process is killed).
 */
export function runProcess(spawn: Spawn, command: string, args: readonly string[], opts: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ChildLike;
    try {
      child = spawn(command, args, { cwd: opts.cwd, windowsHide: true, shell: false });
    } catch (err) {
      reject(notFound(err as Error & { code?: string }, command));
      return;
    }
    const out: string[] = [];
    const err: string[] = [];
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const stop = (reason: string): void => {
      finish(() => reject(new Error(reason)));
      child.kill();
    };
    const timer = setTimeout(() => stop(`no answer after ${Math.round(opts.timeoutMs / 1000)} s; stopped`), opts.timeoutMs);
    const onAbort = (): void => stop("cancelled");
    if (opts.signal?.aborted) return stop("cancelled");
    opts.signal?.addEventListener("abort", onAbort);

    // A UTF-8 character (an accented tag) can be split across two chunks: decode them as one stream.
    const outText = new TextDecoder();
    const errText = new TextDecoder();
    const text = (decoder: TextDecoder, c: unknown): string => (typeof c === "string" ? c : decoder.decode(c as Uint8Array, { stream: true }));
    child.stdout?.on("data", (c) => out.push(text(outText, c)));
    child.stderr?.on("data", (c) => err.push(text(errText, c)));
    child.on("error", (e) => finish(() => reject(notFound(e, command))));
    child.on("close", (code) =>
      finish(() => {
        out.push(outText.decode());
        err.push(errText.decode());
        if (code === 0) resolve(out.join(""));
        else reject(new Error(`exited with code ${code}: ${lastLines(err.join("") || out.join(""))}`));
      }),
    );
    child.stdin?.on("error", () => undefined); // a process that exits without reading stdin: the close event reports it
    child.stdin?.end(opts.input);
  });
}

function notFound(err: Error & { code?: string }, command: string): Error {
  return err.code === "ENOENT" ? new NotFoundError(`"${command}" not found`) : err;
}

function lastLines(text: string): string {
  return text.trim().split("\n").slice(-3).join(" ").slice(0, 400) || "(no output)";
}

/** Tries each command in turn while the previous one is not found. */
export async function runFirstFound(spawn: Spawn, commands: readonly string[], args: readonly string[], opts: RunOptions): Promise<string> {
  let last: Error = new NotFoundError("no command to run");
  for (const command of commands) {
    try {
      return await runProcess(spawn, command, args, opts);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      last = err;
    }
  }
  throw last;
}
