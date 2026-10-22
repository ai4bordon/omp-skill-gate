// Проверяет: тело SKILL.md даёт обязательства, references/ — нет.
import { readFileSync } from "node:fs";

const EXT = "C:/Users/Kerry/.omp/profiles/aggg5/agent/extensions/skill-gate.ts";

const handlers = new Map<string, (e: any, c: any) => unknown>();
const notes: string[] = [];
const contexts: string[] = [];
const pi: any = {
  on: (name: string, fn: any) => handlers.set(name, fn),
  ui: { notify: (m: string) => notes.push(m) },
  log: () => {},
  registerCommand: () => {},
};
const mod: any = await import("file:///" + EXT);
mod.default(pi);

const ctx = { agent: { kind: "main" }, ui: { notify: (m: string) => notes.push(m) } };

async function openSkill(path: string, file: string) {
  const body = readFileSync(file, "utf-8");
  const res: any = await handlers.get("tool_result")!(
    {
      toolName: "read",
      isError: false,
      input: { path },
      content: [{ type: "text", text: `[Skill file: ${file}]\n\n` + body }],
    },
    ctx,
  );
  return res?.additionalContext ?? "";
}

const cases: Array<[string, string, string, boolean]> = [
  ["тело pohuy", "skill://pohuy", "C:/Users/Kerry/.agents/skills/pohuy/SKILL.md", false],
  ["справка pohuy", "skill://pohuy/references/sceny.md", "C:/Users/Kerry/.agents/skills/pohuy/references/sceny.md", false],
  ["тело spec-driven", "skill://spec-driven-development", "C:/Users/Kerry/.agents/skills/spec-driven-development/SKILL.md", true],
];

let pass = 0;
for (const [name, uri, file, expectOblig] of cases) {
  let out = "";
  try {
    out = await openSkill(uri, file);
  } catch (e) {
    console.log(`FAIL ${name}: упало ${(e as Error).message}`);
    continue;
  }
  const has = out.includes("несёт обязательства");
  const ok = has === expectOblig;
  if (ok) pass++;
  const count = /\((\d+)\)/.exec(out)?.[1] ?? "0";
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: обязательств ${count}, ждали ${expectOblig ? ">0" : "0"}`);
}
console.log(`\n${pass}/${cases.length}`);
