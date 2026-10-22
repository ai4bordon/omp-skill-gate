/**
 * bg-skill-gap — фоновый скилл не должен вымывать ход (FR-2).
 *
 * Воспроизводит замечание Советника: агент открыл только фоновый скилл
 * (загружаемый всегда по инструкции профиля) и работал без профильного.
 * Список фоновых скиллов берётся из skill-gate.background.json рядом
 * с расширением; проба запускается из каталога, где этот файл положен.
 *
 *   bun probes/bg-skill-gap.ts [путь-к-расширению]
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const EXT = process.argv[2] ?? join(import.meta.dir, "../src/skill-gate.ts");
type Pi = { on: (ev: string, fn: (e: unknown, c: unknown) => unknown) => void; registerCommand: () => void };
type Handler = (e: unknown, c: unknown) => unknown;
const mod = (await import(pathToFileURL(EXT).href)) as { default: (pi: Pi) => void };
const handlers: Record<string, Handler> = {};
mod.default({ on: (ev, fn) => { handlers[ev] = fn; }, registerCommand: () => {} });
const ctx: unknown = { agent: { kind: "main" }, ui: { notify: () => {} } };
await handlers["input"]({}, ctx);

// pohuy: справочник стиля, обязательств не несёт (как в реальном каталоге)
const POHUY = `# Стиль\n\n## Правила\n- Отвечай живым языком\n- Термины байт в байт\n`;

// 1. агент открывает ТОЛЬКО фоновый скилл
const open = await handlers["tool_result"](
  { toolName: "read", isError: false, input: { path: "skill://pohuy" },
    content: [{ type: "text", text: `[Skill file: C:/skills/pohuy/SKILL.md]\n${POHUY}` }] },
  ctx,
);
console.log("открыт только фоновый скилл, подсказка гейта:", open === undefined ? "нет обязательств" : "есть");

// 2. запись сразу после фонового скилла: должна блокироваться (слой 1 держит)
const write = (await handlers["tool_call"](
  { toolName: "write", input: { path: "calc.test.mjs", content: "..." } },
  ctx,
)) as { block?: boolean } | undefined;
const ok1 = write?.block === true;
console.log(`${ok1 ? "ok  " : "FAIL"} write после фонового скилла: ${write?.block ? "ЗАБЛОКИРОВАН" : "пропущен"}`);

// 3. session_stop: обязательств нет, пропускается (слой 2 молчит) - штатно
const stop = (await handlers["session_stop"]({}, ctx)) as { decision?: string } | undefined;
const ok2 = stop === undefined;
console.log(`${ok2 ? "ok  " : "FAIL"} session_stop без обязательств: ${stop?.decision ?? "пропущен"}`);

// 4. контроль: профильный скилл по-прежнему вымывает ход
await handlers["tool_result"](
  { toolName: "read", isError: false, input: { path: "skill://tdd-workflow" },
    content: [{ type: "text", text: `[Skill file: C:/skills/tdd-workflow/SKILL.md]\n# TDD\n\n## Process\n1. red\n2. green\n3. refactor\n` }] },
  ctx,
);
const write2 = (await handlers["tool_call"](
  { toolName: "write", input: { path: "impl.js", content: "..." } },
  ctx,
)) as { block?: boolean } | undefined;
const ok3 = write2 === undefined || write2.block !== true;
console.log(`${ok3 ? "ok  " : "FAIL"} write после профильного скилла: ${write2?.block ? "ЗАБЛОКИРОВАН (не должно)" : "пропущен"}`);

const passed = [ok1, ok2, ok3].filter(Boolean).length;
console.log(`\n${passed}/3`);
