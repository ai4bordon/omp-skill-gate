/**
 * quote-test — проба правила «цитата без метки»: фрагмент в кавычках принимается,
 * если он реально был в выводе инструмента; выдуманный — нет.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const EXT = "C:/Users/Kerry/.omp/profiles/aggg5/agent/extensions/skill-gate.ts";

const SKILL = `# Демо

## Quality Checklists
- [ ] Пункт первый: красный тест
- [ ] Пункт второй: зелёный тест
`;

async function boot() {
  const work = mkdtempSync(join(tmpdir(), "quote-"));
  const modPath = join(work, "m.ts");
  writeFileSync(modPath, readFileSync(EXT, "utf8"));
  const mod = (await import(pathToFileURL(modPath).href)) as { default: (pi: unknown) => void };
  const handlers: Record<string, any> = {};
  const ctx = { agent: { kind: "main" }, ui: { notify: () => {} } };
  mod.default({
    on: (e: string, fn: any) => { handlers[e] = fn; },
    registerCommand: () => {},
  });
  return { handlers, ctx };
}

const skillRead = {
  toolName: "read",
  isError: false,
  input: { path: "skill://demo" },
  content: [{ type: "text", text: `[Skill file: C:/skills/demo/SKILL.md]\n${SKILL}` }],
};
const bashOut = (text: string) => ({
  toolName: "bash",
  isError: false,
  input: { command: "bun test" },
  content: [{ type: "text", text }],
});
const say = (text: string) => ({ message: { role: "assistant", content: [{ type: "text", text }] } });

let pass = 0;
let total = 0;
async function scenario(name: string, evidence: string, expectBlock: boolean) {
  total++;
  const { handlers, ctx } = await boot();
  await handlers["input"]({}, ctx);
  await handlers["tool_result"](skillRead, ctx);
  await handlers["tool_call"]({ toolName: "bash", input: { command: "bun test" } }, ctx);
  await handlers["tool_result"](
    bashOut("(fail) mul умножает [0.12ms]\n 0 pass\n 1 fail\nExport named 'mul' not found"),
    ctx,
  );
  await handlers["message_update"](
    say(`- сделано: o1 — доказательство: ${evidence}\n- сделано: o2 — доказательство: \`Export named 'mul' not found\``),
    ctx,
  );
  const stop: any = await handlers["session_stop"]({}, ctx);
  const blocked = stop?.decision === "block";
  const ok = blocked === expectBlock;
  if (ok) pass++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}: заблокирован=${blocked}, ждали ${expectBlock}` +
      (stop?.reason ? " | " + String(stop.reason).slice(0, 80) : ""),
  );
}

await scenario("цитата из вывода инструмента принята", "прогон до реализации → `0 pass` и `Export named 'mul' not found`", false);
await scenario("выдуманная цитата отклонена", "прогон до реализации → `4 pass, 0 fail, всё зелёное`", true);

console.log(`\n${pass}/${total}`);
