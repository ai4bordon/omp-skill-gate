// Тест-расширение для ПРОВЕРКИ: работает ли ToolCallEventResult.block в живом omp.
// Живёт в tmp, подключается только флагом `-e`, в профиль не кладётся.
//
//   SKILLGATE=block|nudge|off   режим
//   SKILLGATE_MIN=N             сколько скиллов нужно (по умолчанию 1)
//   SKILLGATE_LOG=path          куда писать след
//   SKILLGATE_TRACE=1           дублировать в stderr
//
// ДЫРА ДИЗАЙНА, которую надо обойти: если блокировать всё, агент не сможет
// выполнить `read skill://` — то есть не сможет выполнить само требование.
// `read` с `skill://` пропускается ВСЕГДА.

import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const MODE = process.env.SKILLGATE ?? "off";
const MIN = Number(process.env.SKILLGATE_MIN ?? "1");
const LOG = process.env.SKILLGATE_LOG ?? "";
const TRACE = process.env.SKILLGATE_TRACE ?? "";

// Тулы, которые меняют систему. Блокировать read/grep/glob бессмысленно.
const HEAVY: Record<string, true> = {
  bash: true, write: true, edit: true, task: true, eval: true, manage_skill: true,
};

// Лечение залипания: без конкретных имён модель повторяет тот же вызов.
// В reason обязаны идти имена, которые ещё НЕ загружены.
const CANDIDATES: Record<string, string[]> = {
  bash: ["systematic-debugging", "debugging-and-error-recovery"],
  write: ["verification-before-completion", "test-driven-development"],
  edit: ["verification-before-completion", "test-driven-development"],
  task: ["task-breakdown", "spec-mode"],
  eval: ["task-breakdown"],
  manage_skill: ["skill-authoring"],
};
function note(msg: string) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  if (LOG) {
    try {
      appendFileSync(LOG, line);
    } catch {
      /* маркерный файл, отказ не должен ронять хук */
    }
  }
  if (TRACE) process.stderr.write(`[skillgate] ${line}`);
}

export default function skillgate(pi: ExtensionAPI) {
  // sessionID -> имена уже загруженных скиллов
  const loaded = new Map<string, string[]>();

  pi.on("session_start", () => {
    note(`BOOT режим=${MODE} min=${MIN}`);
  });

  pi.on("tool_call", (event, ctx) => {
    if (MODE === "off") return;

    const sid = ctx.sessionManager?.getSessionId?.() ?? "default";
    const set: string[] = loaded.get(sid) ?? [];
    loaded.set(sid, set);

    const name = event.toolName as string;
    const input = event.input as Record<string, unknown> | undefined;
    const path = typeof input?.path === "string" ? input.path : "";

    // Загрузка скилла: пропускаем ВСЕГДА, иначе вечный цикл отказов.
    // Считаем ТОЛЬКО имя скилла: `skill://pohuy/references/slovar.md` — это
    // всё ещё pohuy. Иначе четыре вложенных файла одного скилла закрывают гейт.
    if (path.startsWith("skill://")) {
      const skillName = path.slice("skill://".length).split("/")[0];
      if (!set.includes(skillName)) set.push(skillName);
      note(`SKILL+ ${skillName} (${set.length}/${MIN})`);
      return;
    }

    if (set.length >= MIN) {
      note(`PASS ${name} (скиллов хватает: ${set.length}/${MIN})`);
      return;
    }

    const missing = `загрузи скилл через read skill://<имя> (сейчас ${set.length}/${MIN})`;

    if (!HEAVY[name]) {
      note(`SKIP ${name} (не тяжёлый, ${set.length}/${MIN})`);
      return;
    }

    if (MODE === "nudge") {
      note(`NUDGE ${name}`);
      return { additionalContext: `ПЕРЕД ДЕЙСТВИЕМ: ${missing}. Сейчас ты вызываешь ${name}.` };
    }

    // Конкретные имена, которых ещё не хватает. Без них — вечный цикл:
    // модель читает тот же скилл по кругу и снова упирается в BLOCK.
    const want = (CANDIDATES[name] ?? []).filter((s) => !set.includes(s)).slice(0, 3);
    note(`BLOCK ${name} (${set.length}/${MIN}) ждём: ${want.join(",") || "—"}`);
    return {
      block: true,
      reason: want.length
        ? `Остановлено политикой skillgate. Прочитай ЭТИ скиллы (сейчас ${set.length}/${MIN}): ` +
          want.map((s) => `read skill://${s}`).join(", ") + `. Потом повтори ${name}.`
        : `Остановлено политикой skillgate: все скиллы загружены, но счётчик не сошёлся. Повтори ${name}.`,
    };
  });
}