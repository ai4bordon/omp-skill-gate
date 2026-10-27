/**
 * decl-line — строка выбора скилла «скиллы: X — беру X» (R10, v5.3.2).
 *
 * Баг из чата aggg5 (28.10): модель объявила фоновый скилл строкой, гейт знал
 * только «скиллов нет» — три блокировки подряд. Теперь: все имена фоновые →
 * вымывает; есть профильное → заявка, ждём read; без декларации → блок.
 *
 *   bun probes/decl-line.ts [путь-к-расширению]
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

const say = (text: string) => ({ message: { role: "assistant", content: [{ type: "text", text }] } });

// 1. модель пишет строку выбора скилла, как в чате aggg5
await handlers["message_update"](say("скиллы: pohuy — беру его, ultra-режим уже загружен в этой сессии."), ctx);

// 2. пробует bash — в чате aggg5 было три блокировки подряд
const bash = (await handlers["tool_call"](
  { toolName: "bash", input: { command: "omp --version" } },
  ctx,
)) as { block?: boolean } | undefined;
const ok1 = bash?.block !== true;
console.log(`${ok1 ? "ok  " : "FAIL"} bash после строки «скиллы: X — беру X»: ${bash?.block ? "ЗАБЛОКИРОВАН (дыра)" : "пропущен"}`);

// 3. контроль: декларация «скиллов нет» по-прежнему работает
await handlers["input"]({}, ctx);
await handlers["message_update"](say("скиллов нет — задача бытовая, профильных скиллов не вижу."), ctx);
const bash2 = (await handlers["tool_call"](
  { toolName: "bash", input: { command: "omp --version" } },
  ctx,
)) as { block?: boolean } | undefined;
const ok2 = bash2?.block !== true;
console.log(`${ok2 ? "ok  " : "FAIL"} bash после «скиллов нет»: ${bash2?.block ? "ЗАБЛОКИРОВАН (регресс)" : "пропущен"}`);

// 4. контроль: без всего — блок остаётся
await handlers["input"]({}, ctx);
const bash3 = (await handlers["tool_call"](
  { toolName: "bash", input: { command: "omp --version" } },
  ctx,
)) as { block?: boolean } | undefined;
const ok3 = bash3?.block === true;
console.log(`${ok3 ? "ok  " : "FAIL"} bash без декларации: ${bash3?.block ? "ЗАБЛОКИРОВАН" : "пропущен (слой 1 мёртв)"}`);

const passed = [ok1, ok2, ok3].filter(Boolean).length;
console.log(`\n${passed}/3`);
// v5.3.2 дополнение: строка с фоном + профильным НЕ вымывает (заявка, не исполнение)
await handlers["input"]({}, ctx);
await handlers["message_update"](say("скиллы: pohuy, tdd — беру tdd"), ctx);
const bash4 = (await handlers["tool_call"](
  { toolName: "bash", input: { command: "omp --version" } },
  ctx,
)) as { block?: boolean } | undefined;
const ok4 = bash4?.block === true;
console.log(`${ok4 ? "ok  " : "FAIL"} bash после «скиллы: pohuy, tdd — беру tdd»: ${bash4?.block ? "ЗАБЛОКИРОВАН (заявка ≠ исполнение)" : "пропущен (дыра!)"}`);
// v5.3.2: обычное тире вместо длинного
await handlers["input"]({}, ctx);
await handlers["message_update"](say("скиллы: pohuy - беру pohuy"), ctx);
const bash5 = (await handlers["tool_call"](
  { toolName: "bash", input: { command: "omp --version" } },
  ctx,
)) as { block?: boolean } | undefined;
const ok5 = bash5?.block !== true;
console.log(`${ok5 ? "ok  " : "FAIL"} bash после «скиллы: pohuy - беру pohuy» (обычное тире): ${bash5?.block ? "ЗАБЛОКИРОВАН" : "пропущен"}`);
const passed2 = [ok4, ok5].filter(Boolean).length;
console.log(`доп. кейсы: ${passed2}/2`);
