/**
 * obligations-test — проба слоя 2 (обязательства из SKILL.md) расширения skill-gate.
 *
 * Фейковый `pi`, без сети и без модели. Проверяет извлечение обязательств из текста
 * скилла, статусы, проверку доказательств по журналу хода и предохранитель.
 * Спека: `.kiro/specs/skill-gate-obligations/`.
 *
 *   bun run obligations-test.ts
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const EXT = "C:/Users/Kerry/.omp/profiles/aggg5/agent/extensions/skill-gate.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
type Harness = {
  notes: string[];
  run: (name: string, event?: unknown) => Promise<unknown>;
  command: (args: string) => Promise<unknown>;
};

// Скилл в стиле реальных: чек-лист из трёх пунктов
const SKILL_CHECKLIST = `# Демо-скилл

## Quality Checklists
- [ ] Пункт первый: собрать требования
- [ ] Пункт второй: проверить краевые случаи
- [ ] Пункт третий: описать риски
`;

// Некодовый скилл в стиле дизайнерских: нумерованные шаги процесса
const SKILL_STEPS = `# Дизайн

## Process
1. Собрать референсы
2. Выбрать палитру и типографику
3. Собрать макет
`;

async function boot(): Promise<Harness> {
  const work = mkdtempSync(join(tmpdir(), "oblig-v5-"));
  const modPath = join(work, "m.ts");
  writeFileSync(modPath, readFileSync(EXT, "utf8"));
  // Динамический импорт обязателен: путь к копии создаётся в рантайме (mkdtemp),
  // статический импорт здесь невозможен — это тест границы загрузки модуля.
  const mod = (await import(pathToFileURL(modPath).href)) as { default: (pi: unknown) => void };

  const handlers: Record<string, Handler> = {};
  const notes: string[] = [];
  let commandHandler: ((args: string, ctx: unknown) => unknown) | null = null;
  const ctx = { agent: { kind: "main" }, ui: { notify: (m: string) => notes.push(m) } };

  mod.default({
    on: (ev: string, fn: Handler) => { handlers[ev] = fn; },
    registerCommand: (_n: string, spec: { handler: (args: string, ctx: unknown) => unknown }) => {
      commandHandler = spec.handler;
    },
  });

  return {
    notes,
    run: async (name, event = {}) => handlers[name]?.(event, ctx),
    command: async (args) => commandHandler?.(args, ctx),
  };
}

const skillRead = (name: string, body: string) => ({
  toolName: "read",
  isError: false,
  input: { path: `skill://${name}` },
  content: [{ type: "text", text: `[Skill file: C:/skills/${name}/SKILL.md]\n${body}` }],
});
const say = (text: string) => ({ message: { role: "assistant", content: [{ type: "text", text }] } });

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
}

// --- 1. Обязательства извлекаются из текста скилла и подсказка уходит агенту ---
{
  const h = await boot();
  await h.run("input");
  const res = (await h.run("tool_result", skillRead("demo", SKILL_CHECKLIST))) as
    | { additionalContext?: string }
    | undefined;
  const notice = res?.additionalContext ?? "";
  check(
    "1. чек-лист скилла превращается в обязательства o1..o3",
    /\[o1\]/.test(notice) && /\[o3\]/.test(notice) && /сделано: <id>/.test(notice),
    notice.slice(0, 130),
  );
}

// --- 2. Ход-справка: только чтение скилла, статусы не требуются ---
{
  const h = await boot();
  await h.run("input");
  await h.run("tool_result", skillRead("demo", SKILL_CHECKLIST));
  const stop = await h.run("session_stop", {});
  check("2. ход-справка без работы не требует статусов", stop === undefined, `вернул=${String(JSON.stringify(stop)).slice(0, 60)}`);
}

// --- 3. Работа без статусов → блок ---
{
  const h = await boot();
  await h.run("input");
  await h.run("tool_result", skillRead("demo", SKILL_CHECKLIST));
  await h.run("tool_call", { toolName: "write", input: { path: "out.md" } });
  const stop = (await h.run("session_stop", {})) as { decision?: string; reason?: string } | undefined;
  check(
    "3. работа без статусов блокирует завершение",
    stop?.decision === "block" && /без статуса/.test(stop.reason ?? ""),
    `decision=${stop?.decision}`,
  );
}

// --- 4. Все пункты закрыты настоящими доказательствами → пропуск ---
{
  const h = await boot();
  await h.run("input");
  await h.run("tool_result", skillRead("demo", SKILL_CHECKLIST));
  await h.run("tool_call", { toolName: "write", input: { path: "out.md" } });
  await h.run("message_update", say([
    "Готово.",
    "сделано: o1 — доказательство: out.md",
    "сделано: o2 — доказательство: out.md",
    "сделано: o3 — доказательство: out.md",
  ].join("\n")));
  const stop = await h.run("session_stop", {});
  check("4. доказательства из журнала хода принимаются", stop === undefined, `вернул=${String(JSON.stringify(stop)).slice(0, 60)}`);
}

// --- 5. «сделано» с выдуманным доказательством → блок ---
{
  const h = await boot();
  await h.run("input");
  await h.run("tool_result", skillRead("demo", SKILL_CHECKLIST));
  await h.run("tool_call", { toolName: "write", input: { path: "out.md" } });
  await h.run("message_update", say([
    "сделано: o1 — доказательство: requirements-final.md",
    "сделано: o2 — доказательство: out.md",
    "сделано: o3 — доказательство: out.md",
  ].join("\n")));
  const stop = (await h.run("session_stop", {})) as { decision?: string; reason?: string } | undefined;
  check(
    "5. выдуманное доказательство не принимается",
    stop?.decision === "block" && /без подтверждения/.test(stop.reason ?? ""),
    `decision=${stop?.decision}`,
  );
}

// --- 6. «неприменимо» с причиной снимает пункт ---
{
  const h = await boot();
  await h.run("input");
  await h.run("tool_result", skillRead("demo", SKILL_CHECKLIST));
  await h.run("tool_call", { toolName: "write", input: { path: "out.md" } });
  await h.run("message_update", say([
    "сделано: o1 — доказательство: out.md",
    "неприменимо: o2 — в задаче нет краевых случаев",
    "неприменимо: o3 — риски описаны в o1",
  ].join("\n")));
  const stop = await h.run("session_stop", {});
  check("6. неприменимо с причиной закрывает пункт", stop === undefined, `вернул=${String(JSON.stringify(stop)).slice(0, 60)}`);
}

// --- 7. «не сделано» разрешено, но попадает в сводку как честный пробел ---
{
  const h = await boot();
  await h.run("input");
  await h.run("tool_result", skillRead("demo", SKILL_CHECKLIST));
  await h.run("tool_call", { toolName: "write", input: { path: "out.md" } });
  await h.run("message_update", say([
    "сделано: o1 — доказательство: out.md",
    "сделано: o2 — доказательство: out.md",
    "не сделано: o3 — не хватило времени на описание рисков",
  ].join("\n")));
  const stop = await h.run("session_stop", {});
  await h.run("agent_end", {});
  const line = h.notes.find((n) => n.includes("обязательства:")) ?? "";
  check(
    "7. честный пробел не блокирует, но виден в сводке",
    stop === undefined && line.includes("честных пробелов: 1"),
    line || "строки нет",
  );
}

// --- 8. Предохранитель: после 3 отказов гейт сдаётся ---
{
  const h = await boot();
  await h.run("input");
  await h.run("tool_result", skillRead("demo", SKILL_CHECKLIST));
  await h.run("tool_call", { toolName: "write", input: { path: "out.md" } });
  const verdicts: unknown[] = [];
  for (let i = 0; i < 4; i++) verdicts.push(await h.run("session_stop", {}));
  const blocked = verdicts.slice(0, 3).every((v) => (v as { decision?: string } | undefined)?.decision === "block");
  const gaveUp = verdicts[3] === undefined;
  check(
    "8. после 3 отказов гейт сдаётся и пишет карточку",
    blocked && gaveUp && h.notes.some((n) => n.includes("НЕ ПРИНЯТО")),
    `block×3=${blocked}, молчит=${gaveUp}`,
  );
}

// --- 9. Некодовый домен: дизайн-скилл, доказательство — файл макета ---
{
  const h = await boot();
  await h.run("input");
  const res = (await h.run("tool_result", skillRead("design-demo", SKILL_STEPS))) as
    | { additionalContext?: string }
    | undefined;
  await h.run("tool_call", { toolName: "write", input: { path: "design/palette.css" } });
  await h.run("message_update", say([
    "сделано: o1 — доказательство: design/palette.css",
    "сделано: o2 — доказательство: design/palette.css",
    "сделано: o3 — доказательство: design/palette.css",
  ].join("\n")));
  const stop = await h.run("session_stop", {});
  check(
    "9. некодовый скилл (дизайн) работает так же",
    /\[o3\]/.test(res?.additionalContext ?? "") && stop === undefined,
    `пунктов=${(res?.additionalContext ?? "").match(/\[o\d\]/g)?.length ?? 0}, блок=${String(JSON.stringify(stop)).slice(0, 40)}`,
  );
}

// --- 10. Реальный SKILL.md: code-review даёт обязательства из шагов процесса ---
{
  const h = await boot();
  await h.run("input");
  const body = readFileSync("C:/Users/Kerry/.agents/skills/code-review/SKILL.md", "utf8");
  const res = (await h.run("tool_result", skillRead("code-review", body))) as
    | { additionalContext?: string }
    | undefined;
  const count = (res?.additionalContext ?? "").match(/\[o\d\]/g)?.length ?? 0;
  check("10. настоящий code-review даёт 5-6 обязательств", count >= 5, `пунктов=${count}`);
}

// --- 11. Скилл-справочник без процесса обязательств не даёт ---
{
  const h = await boot();
  await h.run("input");
  const body = readFileSync("C:/Users/Kerry/.agents/skills/bun-package-manager/SKILL.md", "utf8");
  const res = (await h.run("tool_result", skillRead("bun-package-manager", body))) as
    | { additionalContext?: string }
    | undefined;
  await h.run("tool_call", { toolName: "write", input: { path: "x.txt" } });
  const stop = await h.run("session_stop", {});
  check(
    "11. скилл-справочник не порождает пустых требований",
    res?.additionalContext === undefined && stop === undefined,
    `подсказка=${res?.additionalContext ? "есть" : "нет"}, блок=${String(JSON.stringify(stop)).slice(0, 40)}`,
  );
}


// --- 12. Своё доказательство (файл создан в этом ходе) отличается от внешнего ---
{
  const h = await boot();
  await h.run("input");
  await h.run("tool_result", skillRead("demo", SKILL_CHECKLIST));
  // внешний артефакт: прочитан до правки, значит существовал
  await h.run("tool_call", { toolName: "read", input: { path: "specs/old.md" } });
  // свой артефакт: создан в этом ходе, до этого не читался
  await h.run("tool_call", { toolName: "write", input: { path: "out.md" } });
  await h.run("message_update", say([
    "сделано: o1 — доказательство: specs/old.md",
    "сделано: o2 — доказательство: out.md",
    "неприменимо: o3 — риски описаны в o1",
  ].join("\n")));
  await h.run("agent_end", {});
  const line = h.notes.find((n) => n.includes("доказательства:")) ?? "";
  check(
    "12. счётчик различает внешние и свои доказательства",
    line.includes("внешних 1") && line.includes("своих 1"),
    line || "строки нет",
  );
}


// --- 13. Селектор строки не превращает свой артефакт во внешний ---
{
  const h = await boot();
  await h.run("input");
  await h.run("tool_result", skillRead("demo", SKILL_CHECKLIST));
  await h.run("tool_call", { toolName: "write", input: { path: "out.md" } });
  // агент читает свой же файл ПОСЛЕ записи и ссылается на диапазон строк
  await h.run("tool_call", { toolName: "read", input: { path: "out.md:1-40,79-140" } });
  await h.run("message_update", say([
    "сделано: o1 — доказательство: out.md:12",
    "сделано: o2 — доказательство: out.md",
    "неприменимо: o3 — риски в o1",
  ].join("\n")));
  await h.run("agent_end", {});
  const line = h.notes.find((n) => n.includes("доказательства:")) ?? "";
  check(
    "13. чтение своего файла после записи не делает его внешним",
    line.includes("внешних 0") && line.includes("своих 2"),
    line || "строки нет",
  );
}

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}\n      ${r.detail}`);
  if (!r.ok) failed += 1;
}
console.log(`\n${results.length - failed}/${results.length} прошло`);
process.exit(failed === 0 ? 0 : 1);
