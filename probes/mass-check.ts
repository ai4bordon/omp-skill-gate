/**
 * mass-check — сколько обязательств извлекается из каждого SKILL.md каталога скиллов.
 * Гейт читает файл так же, как read skill://, поэтому прямой прогон
 * извлекателя по каталогу даёт ту же картину без запуска omp.
 *
 *   bun probes/mass-check.ts <каталог-скиллов> [путь-к-расширению]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dirArg = process.argv[2];
if (!dirArg) {
  console.error("использование: bun probes/mass-check.ts <каталог-скиллов> [путь-к-расширению]");
  process.exit(1);
}
const EXT = process.argv[3] ?? join(import.meta.dir, "../src/skill-gate.ts");
type Pi = { on: (ev: string, fn: (e: unknown, c: unknown) => unknown) => void; registerCommand: () => void };
type Handler = (e: unknown, c: unknown) => unknown;
const mod = (await import(pathToFileURL(EXT).href)) as { default: (pi: Pi) => void };
const handlers: Record<string, Handler> = {};
mod.default({ on: (ev, fn) => { handlers[ev] = fn; }, registerCommand: () => {} });
const ctx: unknown = { agent: { kind: "main" }, ui: { notify: () => {} } };
await handlers["input"]({}, ctx);

async function obligationsOf(name: string, path: string): Promise<number> {
  await handlers["input"]({}, ctx);
  const body = readFileSync(path, "utf-8");
  const res = (await handlers["tool_result"](
    {
      toolName: "read",
      isError: false,
      input: { path: `skill://${name}` },
      content: [{ type: "text", text: `[Skill file: ${path}]\n${body}` }],
    },
    ctx,
  )) as { additionalContext?: string } | undefined;
  const m = /\((\d+)\)/.exec(res?.additionalContext ?? "");
  return m ? Number(m[1]) : 0;
}

let zero = 0, nonzero = 0;
const empty: string[] = [];
for (const name of readdirSync(dirArg)) {
  const file = join(dirArg, name, "SKILL.md");
  try {
    const n = await obligationsOf(name, file);
    if (n > 0) { nonzero++; console.log(`${String(n).padStart(2)}  ${name}`); }
    else { zero++; empty.push(name); }
  } catch {
    // нет SKILL.md — не скилл, не считаем
  }
}
console.log(`\nпокрытие: ${nonzero}/${zero + nonzero} скиллов несут обязательства`);
if (empty.length) console.log(`без обязательств: ${empty.slice(0, 12).join(", ")}${empty.length > 12 ? " …" : ""}`);
