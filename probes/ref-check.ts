/**
 * ref-check — тело скилла несёт обязательства, references/ — нет.
 *
 * Проверяет правило isSkillBody: только чтение самого SKILL.md (или корня скилла)
 * порождает обязательства. references/ (глоссарии, оглавления) обязан не давать их.
 *
 * Синтетические случаи работают на любой машине; реальные локальные скиллы
 * проверяются, только если установлены (иначе строка «пропущено»).
 *
 *   bun probes/ref-check.ts [путь-к-расширению]
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const EXT = process.argv[2] ?? join(import.meta.dir, "../src/skill-gate.ts");
type Pi = { on: (ev: string, fn: (e: unknown, c: unknown) => unknown) => void; registerCommand: () => void };
type Handler = (e: unknown, c: unknown) => unknown;
const mod = (await import(pathToFileURL(EXT).href)) as { default: (pi: Pi) => void };
const handlers: Record<string, Handler> = {};
mod.default({ on: (ev, fn) => { handlers[ev] = fn; }, registerCommand: () => {} });
const ctx: unknown = { agent: { kind: "main" }, ui: { notify: () => {} } };
await handlers["input"]({}, ctx);

async function openSkill(path: string, file: string, text: string): Promise<string> {
  const res = (await handlers["tool_result"](
    {
      toolName: "read",
      isError: false,
      input: { path },
      content: [{ type: "text", text: `[Skill file: ${file}]\n\n${text}` }],
    },
    ctx,
  )) as { additionalContext?: string } | undefined;
  return res?.additionalContext ?? "";
}

// Синтетика: работает на любой машине
const SYNTH_BODY = `# Демо\n\n## Process\n1. Собрать референсы\n2. Выбрать палитру\n3. Собрать макет\n`;
const SYNTH_REF = `# Глоссарий\n\n## Шкала\n- Триумф: всё получилось\n- Возня: копается\n`;

// Реальные скиллы: только если установлены локально
const realDir = join(homedir(), ".agents/skills");

let pass = 0;
let total = 0;

{
  total++;
  const out = await openSkill("skill://demo", "C:/skills/demo/SKILL.md", SYNTH_BODY);
  const count = Number(/\((\d+)\)/.exec(out)?.[1] ?? "0");
  const ok = count >= 3;
  if (ok) pass++;
  console.log(`${ok ? "ok  " : "FAIL"} синтет: тело скилла: обязательств ${count}, ждали >=3`);
}

{
  total++;
  const out = await openSkill("skill://demo/references/glossary.md", "C:/skills/demo/references/glossary.md", SYNTH_REF);
  const count = Number(/\((\d+)\)/.exec(out)?.[1] ?? "0");
  const ok = out === "" || count === 0;
  if (ok) pass++;
  console.log(`${ok ? "ok  " : "FAIL"} синтет: references/: обязательств ${count}, ждали 0`);
}

const realCases: Array<[string, string, string, boolean]> = [
  ["тело pohuy", "skill://pohuy", join(realDir, "pohuy/SKILL.md"), false],
  ["справка pohuy", "skill://pohuy/references/sceny.md", join(realDir, "pohuy/references/sceny.md"), false],
  ["тело spec-driven", "skill://spec-driven-development", join(realDir, "spec-driven-development/SKILL.md"), true],
];

for (const [name, uri, file, expectOblig] of realCases) {
  if (!existsSync(file)) {
    console.log(`пропущено: ${name} (файл ${file} не найден)`);
    continue;
  }
  total++;
  const text = readFileSync(file, "utf-8");
  const out = await openSkill(uri, file, text);
  const has = out.includes("несёт обязательства");
  const ok = has === expectOblig;
  if (ok) pass++;
  const count = /\((\d+)\)/.exec(out)?.[1] ?? "0";
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: обязательств ${count}, ждали ${expectOblig ? ">0" : "0"}`);
}

console.log(`\n${pass}/${total}`);
