/**
 * toggle-probe — слэш-команда on/off (R12).
 *
 * off должен снимать блокировку write в грязном ходе, on - возвращать,
 * статус и мусорный аргумент не падают, ходовая статистика (dirty, блоки)
 * переживает off→on без сброса.
 *
 *   bun probes/toggle-probe.ts [путь-к-расширению]
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const EXT = process.argv[2] ?? join(import.meta.dir, "../src/skill-gate.ts");
type Pi = {
  on: (ev: string, fn: (e: unknown, c: unknown) => unknown) => void;
  registerCommand: (name: string, opts: { description?: string; handler: (args: string, ctx: unknown) => Promise<void> | void }) => void;
};

// dynamic import оправдан: путь копии создаётся в рантайме (mkdtemp) — plugin loading
const work = mkdtempSync(join(tmpdir(), "tog-"));
const modPath = join(work, "m.ts");
writeFileSync(modPath, readFileSync(EXT, "utf8"));
const mod = (await import(pathToFileURL(modPath).href)) as { default: (pi: Pi) => void };

const handlers: Record<string, (e: unknown, c: unknown) => unknown> = {};
let command: { handler: (args: string, ctx: unknown) => Promise<void> | void } | undefined;
mod.default({
  on: (ev, fn) => { handlers[ev] = fn; },
  registerCommand: (_n, opts) => { command = opts; },
});
const notes: string[] = [];
const ctx: unknown = { agent: { kind: "main" }, ui: { notify: (t: string) => notes.push(t), setStatus: () => {} } };
if (!command) { console.log("FAIL команда не зарегистрирована"); process.exit(1); }

// грязный ход без скилла и декларации
await handlers["input"]({}, ctx);
const blocked = (await handlers["tool_call"](
  { toolName: "write", input: { path: "x.md", content: "..." } },
  ctx,
)) as { block?: boolean } | undefined;
console.log(`исходно write в грязном ходе: ${blocked?.block ? "ЗАБЛОКИРОВАН (как надо)" : "ПРОПУЩЕН (не должно)"}`);
const ok0 = blocked?.block === true;

// off: блокировка снята, сводка молчит
await command.handler("off", ctx);
const pass = (await handlers["tool_call"](
  { toolName: "write", input: { path: "x.md", content: "..." } },
  ctx,
)) as { block?: boolean } | undefined;
const ok1 = pass === undefined;
console.log(`${ok1 ? "ok  " : "FAIL"} /skill-gate off: write ${pass === undefined ? "прошёл" : "заблокирован"}`);

// session_stop в выключенном состоянии не требует статусов
const stopOff = (await handlers["session_stop"]({}, ctx)) as { decision?: string } | undefined;
const ok1b = stopOff === undefined;
console.log(`${ok1b ? "ok  " : "FAIL"} off: session_stop ${stopOff === undefined ? "молчит" : "блокирует: " + stopOff.decision}`);

// agent_end в выключенном состоянии молчит (R12.6)
notes.length = 0;
await handlers["agent_end"]({}, ctx);
const ok1c = notes.length === 0;
console.log(`${ok1c ? "ok  " : "FAIL"} off: agent_end ${notes.length === 0 ? "молчит" : "спамит: " + notes.join(" | ")}`);

// on: блокировка вернулась, ходовая статистика не сброшена (dirty, total вырос)
await command.handler("on", ctx);
const reblock = (await handlers["tool_call"](
  { toolName: "write", input: { path: "y.md", content: "..." } },
  ctx,
)) as { block?: boolean } | undefined;
const ok2 = reblock?.block === true;
console.log(`${ok2 ? "ok  " : "FAIL"} /skill-gate on: write ${reblock?.block ? "снова заблокирован" : "прошёл (не должно)"}`);

// статус: не меняет режим, показывает счётчики (total >= 2 без сброса)
notes.length = 0;
await command.handler("", ctx);
const st = notes.join(" ");
const ok3 = /включён/.test(st) && /total: [2-9]/.test(st);
console.log(`${ok3 ? "ok  " : "FAIL"} статус без аргумента: ${st || "(пусто)"}`);

// мусорный аргумент: подсказка, режим не меняется
notes.length = 0;
await command.handler("абракадабра", ctx);
const junk = notes.join(" ");
const stillOn = (await handlers["tool_call"](
  { toolName: "write", input: { path: "z.md", content: "..." } },
  ctx,
)) as { block?: boolean } | undefined;
const ok4 = /не понял/.test(junk) && stillOn?.block === true;
console.log(`${ok4 ? "ok  " : "FAIL"} мусорный аргумент: ${junk || "(пусто)"} · write ${stillOn?.block ? "заблокирован" : "прошёл"}`);

// status-синоним
notes.length = 0;
await command.handler("status", ctx);
const ok5 = /включён/.test(notes.join(" "));
console.log(`${ok5 ? "ok  " : "FAIL"} /skill-gate status - синоним`);

const all = [ok0, ok1, ok1b, ok1c, ok2, ok3, ok4, ok5];
console.log(`\n${all.filter(Boolean).length}/${all.length}`);
if (all.some((b) => !b)) process.exit(1);
