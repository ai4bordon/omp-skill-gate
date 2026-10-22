/**
 * fam-breakdown — покрытие обязательствами по семействам скиллов.
 * Гейт молчит при нуле обязательств (проба 11 из obligations-test),
 * поэтому «нет additionalContext» = «справочник, пунктов нет».
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const EXT = "C:/Users/Kerry/.omp/profiles/aggg5/agent/extensions/skill-gate.ts";

type Pi = {
  on: (ev: string, fn: (event: unknown, ctx: unknown) => unknown) => void;
  registerCommand: () => void;
};
type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;
type NoticeResult = { additionalContext?: string } | undefined;

const mod = (await import(pathToFileURL(EXT).href)) as { default: (pi: Pi) => void };
const handlers: Record<string, Handler> = {};
mod.default({
  on: (ev, fn) => { handlers[ev] = fn; },
  registerCommand: () => {},
});
const ctx: unknown = { agent: { kind: "main" }, ui: { notify: () => {} } };

const skillRead = (name: string, body: string) => ({
  toolName: "read",
  isError: false,
  input: { path: `skill://${name}` },
  content: [{ type: "text", text: `[Skill file: C:/skills/${name}/SKILL.md]\n${body}` }],
});

async function countObligations(name: string, file: string): Promise<number> {
  await handlers["input"]({}, ctx);
  const body = readFileSync(file, "utf-8");
  const res = (await handlers["tool_result"](skillRead(name, body), ctx)) as NoticeResult;
  return (res?.additionalContext ?? "").match(/\[o\d\]/g)?.length ?? 0;
}

const family = (n: string): string => {
  if (n.startsWith("firecrawl-")) return "firecrawl-*";
  if (n.startsWith("camoufox-")) return "camoufox-*";
  if (n.startsWith("tavily-")) return "tavily-*";
  if (n.startsWith("hyperframes-")) return "hyperframes-*";
  if (n.startsWith("powershell-")) return "powershell-*";
  if (n.startsWith("mcp-")) return "mcp-*";
  if (n.startsWith("memory")) return "memory*";
  if (n.startsWith("spec-")) return "spec-*";
  if (n.startsWith("test-driven") || n.startsWith("tdd")) return "tdd/test*";
  return "прочие";
};

for (const p of process.argv.slice(2)) {
  const dir = `C:/Users/Kerry/.omp/profiles/${p}/agent/skills`;
  const rows: Array<[string, number]> = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, "SKILL.md");
    try { rows.push([name, await countObligations(name, file)]); } catch { /* без SKILL.md */ }
  }
  const withO = rows.filter(([, c]) => c > 0);
  const fams = new Map<string, { n: number; covered: number }>();
  for (const [name, c] of rows) {
    const f = family(name);
    const e = fams.get(f) ?? { n: 0, covered: 0 };
    e.n++; if (c > 0) e.covered++;
    fams.set(f, e);
  }
  const pct = Math.round((withO.length / rows.length) * 100);
  console.log(`\n=== ${p}: ${withO.length}/${rows.length} (${pct}%)`);
  console.log("семейство            скиллов  с пунктами");
  for (const [f, e] of [...fams].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`${f.padEnd(20)} ${String(e.n).padStart(5)}   ${String(e.covered).padStart(5)}`);
  }
  const top = rows.filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`топ по пунктам: ${top.map(([n, c]) => `${n}=${c}`).join(", ")}`);
}
