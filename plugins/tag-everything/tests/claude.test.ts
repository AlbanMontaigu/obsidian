import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { NotFoundError, type Spawn, runFirstFound, runProcess } from "../src/claude.ts";

const node = process.execPath;
const run = spawn as unknown as Spawn;
const opts = { cwd: tmpdir(), input: "", timeoutMs: 20_000 };

test("runProcess: stdin in, stdout out, in the working folder", async () => {
  const script = "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(s.toUpperCase()+'|'+process.cwd()))";
  const out = await runProcess(run, node, ["-e", script], { ...opts, input: "héllo \"quoted\" {json}" });
  assert.equal(out, `HÉLLO "QUOTED" {JSON}|${tmpdir()}`);
});

test("runProcess: a failing exit gives the end of stderr", async () => {
  await assert.rejects(runProcess(run, node, ["-e", "console.error('first');console.error('boom');process.exit(3)"], opts), /code 3: first boom/);
});

test("runProcess: timeout and cancel kill the process", async () => {
  const forever = ["-e", "setInterval(()=>{},1000)"];
  await assert.rejects(runProcess(run, node, forever, { ...opts, timeoutMs: 300 }), /no answer after 0 s; stopped/);
  const ac = new AbortController();
  const p = runProcess(run, node, forever, { ...opts, signal: ac.signal });
  setTimeout(() => ac.abort(), 200);
  await assert.rejects(p, /^Error: cancelled$/);
});

test("runFirstFound: a missing command tries the next one, other errors stop", async () => {
  await assert.rejects(runProcess(run, "no-such-program-xyz", [], opts), NotFoundError);
  assert.equal(await runFirstFound(run, ["no-such-program-xyz", node], ["-e", "process.stdout.write('ok')"], opts), "ok");
  await assert.rejects(runFirstFound(run, ["no-such-program-xyz"], [], opts), /"no-such-program-xyz" not found/);
  await assert.rejects(runFirstFound(run, [node, "never-tried"], ["-e", "process.exit(1)"], opts), /code 1/);
});
