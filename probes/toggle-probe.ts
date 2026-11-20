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


// v5.5: сессия стартует с ВЫКЛЮЧЕННЫМ гейтом: write без команд.
// Включение - тот же предикат, что в коде (R12.10): только 1|on|true,
// иначе SKILL_GATE=0 (рекомендован в bench/README и D12) ронял бы пробу.
const envOn = /^(1|on|true)$/.test(process.env.SKILL_GATE ?? "");
const expectOff = !envOn;
await handlers["input"]({}, ctx);
const startPass = (await handlers["tool_call"](
  { toolName: "write", input: { path: "pre.md", content: "..." } },
  ctx,
)) as { block?: boolean } | undefined;
const okStart = expectOff ? startPass === undefined : startPass?.block === true;
console.log(
  `${okStart ? "ok  " : "FAIL"} старт сессии: гейт ${expectOff ? "выключен, write " + (startPass === undefined ? "проходит" : "заблокирован") : "поднят env, write " + (startPass?.block ? "блокируется" : "проходит")}`,
);
if (!okStart) process.exit(1);

// включаем вручную: дальше прежние кейсы проверяют on/off в обе стороны
await command.handler("on", ctx);
// грязный ход без скилла и декларации
await handlers["input"]({}, ctx);
const blocked = (await handlers["tool_call"](
  { toolName: "write", input: { path: "x.md", content: "..." } },
  ctx,
)) as { block?: boolean } | undefined;
console.log(`исходно write в грязном ходе: ${blocked?.block ? "ЗАБЛОКИРОВАН (как надо)" : "ПРОПУЩЕН (не должно)"}`);

// старт-off→on: включение до хода; write в грязном ходе снова блокируется
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

const all = [okStart, ok0, ok1, ok1b, ok1c, ok2, ok3, ok4, ok5];
console.log(`\n${all.filter(Boolean).length}/${all.length}`);

// v5.5/env: SKILL_GATE=1|on|true включает гейт при загрузке (headless-стенд без
// слэш-команд), SKILL_GATE=0 оставляет выключенным. Предикат - как в коде (R12.10).
// Кейсы выше уже включали гейт командами, поэтому старт проверяем на СВЕЖЕЙ копии:
// новый путь = новый модуль, переменная читается при import.
{
  const freshPath = join(work, "m-env.ts");
  writeFileSync(freshPath, readFileSync(EXT, "utf8"));
  const freshMod = (await import(pathToFileURL(freshPath).href)) as { default: (pi: Pi) => void };
  const fh: Record<string, (e: unknown, c: unknown) => unknown> = {};
  freshMod.default({ on: (ev, fn) => { fh[ev] = fn; }, registerCommand: () => {} });
  await fh["input"]({}, ctx);
  const passEnv = (await fh["tool_call"](
    { toolName: "write", input: { path: "env.md", content: "..." } },
    ctx,
  )) as { block?: boolean } | undefined;
  const label = process.env.SKILL_GATE ?? "(не задан)";
  if (envOn) {
    const okEnv = passEnv?.block === true;
    console.log(`${okEnv ? "ok  " : "FAIL"} SKILL_GATE=${label}: гейт активен с загрузки`);
    if (!okEnv) process.exit(1);
  } else {
    const okEnv0 = passEnv === undefined;
    console.log(`${okEnv0 ? "ok  " : "FAIL"} SKILL_GATE=${label}: гейт выключен с загрузки`);
    if (!okEnv0) process.exit(1);
  }
}
if (all.some((b) => !b)) process.exit(1);
