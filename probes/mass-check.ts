/**
 * mass-check — сколько обязательств извлекается из каждого SKILL.md профиля.
 * Гейт читает файл так же, как read skill://, поэтому прямой прогон
 * извлекателя по каталогу скиллов даёт ту же картину без запуска omp.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const EXT = "C:/Users/Kerry/.omp/profiles/aggg5/agent/extensions/skill-gate.ts";
const mod: any = await import("file:///" + EXT.replace(/\\/g, "/"));

// extractObligations не экспортирована: вытаскиваем через контекст tool_result
const handlers: Record<string, any> = {};
const pi: any = {
  on: (n: string, fn: any) => { handlers[n] = fn; },
  registerCommand: () => {},
};
mod.default(pi);
const ctx = { agent: { kind: "main" }, ui: { notify: () => {} } };

async function obligationsOf(path: string): Promise<number> {
  await handlers["input"]({}, ctx);
  const body = readFileSync(path, "utf-8");
  const res: any = await handlers["tool_result"](
    {
      toolName: "read",
      isError: false,
      input: { path: `skill://body-check` },
      content: [{ type: "text", text: `[Skill file: ${path}]\n${body}` }],
    },
    ctx,
  );
  const n = /\((\d+)\)/.exec(res?.additionalContext ?? "")?.[1];
  return n ? Number(n) : 0;
}

const profiles = process.argv.slice(2);
for (const p of profiles) {
  const dir = `C:/Users/Kerry/.omp/profiles/${p}/agent/skills`;
  let zero = 0, nonzero = 0;
  const empty: string[] = [];
  // Deno нет под рукой: перечисляем через readFileSync
  const { readdirSync } = await import("node:fs");
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, "SKILL.md");
    try {
      const n = await obligationsOf(file);
      if (n > 0) nonzero++;
      else { zero++; empty.push(name); }
    } catch {
      zero++; empty.push(name + " (упало)");
    }
  }
  console.log(`\n=== ${p}: скиллов ${zero + nonzero}, с обязательствами ${nonzero}, без них ${zero}`);
  console.log("   без обязательств: " + empty.slice(0, 12).join(", ") + (empty.length > 12 ? " …" : ""));
}
