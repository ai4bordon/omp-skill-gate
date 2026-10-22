/**
 * ref-check — тело скилла несёт обязательства, references/ — нет.
 * Запускается на локальных SKILL.md; в CI-подобном прогоне необязателен.
 *
 *   bun probes/ref-check.ts [путь-к-расширению]
 */
import { readFileSync } from "node:fs";
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

const read = (path: string, text: string) => ({
  toolName: "read", isError: false, input: { path },
  content: [{ type: "text", text: `[Skill file: ${path}]\n${text}` }],
});
const count = async (path: string, text: string): Promise<number> => {
  const res = (await handlers["tool_result"](read(path, text), ctx)) as { additionalContext?: string } | undefined;
  return (res?.additionalContext ?? "").match(/\[o\d\]/g)?.length ?? 0;
};

// демонстрация на синтетических текстах: воспроизводимо без личных скиллов
const BODY = `# Демо

## Process
1. Собрать референсы
2. Выбрать палитру
3. Собрать макет
`;
const REF = `# Глоссарий

## Шкала состояний
- Триумф: всё получилось
- Норма: работает
- Возня: копается
`;

let pass = 0;
let total = 0;
const cases: Array<[string, number]> = [
  ["тело скилла (Process)", await count("skill://demo", BODY)],
  ["references/ глоссарий", await count("skill://demo/references/glossary.md", REF)],
];
for (const [name, n] of cases) total++;
if (cases[0][1] >= 3) pass++; else console.log(`FAIL: тело дало ${cases[0][1]} обязательств, ждали >= 3`);
if (cases[1][1] === 0) pass++; else console.log(`FAIL: references дал ${cases[1][1]} обязательств, ждали 0`);
console.log(`тело скилла: ${cases[0][1]} обязательств (ждали >=3)`);
console.log(`references/: ${cases[1][1]} обязательств (ждали 0)`);
console.log(`${pass}/${total}`);
