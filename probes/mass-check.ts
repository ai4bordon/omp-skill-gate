/**
 * mass-check — покрытие обязательствами каталога скиллов профиля OMP.
 *   bun probes/mass-check.ts <профиль> [<каталог-скиллов>]
 * По умолчанию: ~/.omp/profiles/<профиль>/agent/skills.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const EXT = process.argv[3] ?? join(import.meta.dir, "../src/skill-gate.ts");
type Pi = { on: (ev: string, fn: (e: unknown, c: unknown) => unknown) => void; registerCommand: () => void };
type Handler = (e: unknown, c: unknown) => unknown;
const mod = (await import(pathToFileURL(EXT).href)) as { default: (pi: Pi) => void };
const handlers: Record<string, Handler> = {};
mod.default({ on: (ev, fn) => { handlers[ev] = fn; }, registerCommand: () => {} });
const ctx: unknown = { agent: { kind: "main" }, ui: { notify: () => {} } };
await handlers["input"]({}, ctx);

async function countObligations(name: string, file: string): Promise<number> {
  await handlers["input"]({}, ctx);
  const body = readFileSync(file, "utf-8");
  const res = (await handlers["tool_result"](
    { toolName: "read", isError: false, input: { path: `skill://${name}` },
      content: [{ type: "text", text: `[Skill file: ${file}]\n${body}` }] },
    ctx,
  )) as { additionalContext?: string } | undefined;
  return (res?.additionalContext ?? "").match(/\[o\d\]/g)?.length ?? 0;
}

const dirArg = process.argv[2];
if (!dirArg) { console.error("использование: bun probes/mass-check.ts <каталог-скиллов> [путь-к-расширению]"); process.exit(1); }
const dir = dirArg;
let withO = 0, total = 0;
for (const name of readdirSync(dir)) {
  const file = join(dir, name, "SKILL.md");
  try {
    const n = await countObligations(name, file);
    total++;
    if (n > 0) { withO++; console.log(`${String(n).padStart(2)}  ${name}`); }
  } catch { /* нет SKILL.md — не скилл */ }
}
console.log(`\nпокрытие: ${withO}/${total} скиллов несут обязательства`);
