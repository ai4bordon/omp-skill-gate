// skill-gate: надсмотрщик скиллов для OMP.
// Слой 1 (v3.2): в ходе нельзя действовать, пока не открыт скилл или не объявлено «скиллов нет».
// Слой 2 (v5): обязательства берутся из самого SKILL.md при его открытии — чек-листы и нумерованные
// шаги. Каждый пункт обязан получить статус с доказательством, которое проверяется по журналу хода.
// Домен не важен: код, дизайн, ресёрч, тексты — механизм один и тот же.
// Спека: .kiro/specs/skill-gate-obligations/.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---- конфиг (NFR-2: одно место) ----
const GATED_TOOLS: Record<string, true> = {
  edit: true, write: true, ast_edit: true,
  read: true, grep: true, glob: true, find: true,
  bash: true, eval: true, web_search: true, task: true,
};
// Фоновые скиллы: грузятся всегда по инструкции профиля, это не выбор агента.
// Список живёт в skill-gate.background.json рядом с расширением (одна строка на профиль);
// при его отсутствии фоновых скиллов нет. Открытие только фонового скилла не вымывает ход (FR-2).
const BACKGROUND_SKILLS: Record<string, true> = (() => {
  try {
    const raw = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "skill-gate.background.json"),
      "utf-8",
    );
    const list: unknown = JSON.parse(raw);
    const out: Record<string, true> = {};
    if (Array.isArray(list)) for (const s of list) if (typeof s === "string" && s) out[s] = true;
    return out;
  } catch {
    return {};
  }
})();
const MCP_PREFIX = "mcp__";
// Внутренние схемы: правки по ним гейтом не считаются (FR-6)
const INTERNAL_SCHEME = /^(xd|local|agent|mcp|proc|skill|omp|ssh|issue|pr|cfg|security|history|artifact|db)[\w.-]*:/i;
// Декларация «скиллов нет» - строка в начале строки ответа (FR-3)
const DECLARED_NO_SKILL = /(^|\n)\s*(скиллов?\s+нет|no\s+(applicable\s+|matching\s+|relevant\s+)?skills?)/mi;
// Декларация выбора скилла строкой: «скиллы: X, Y — беру X» (R10).
// Имена до тире; «беру»/«взял» фиксируют, что это решение, а не упоминание.
const DECLARED_SKILL_LINE =
  /(^|\n)[ \t]*(?:[-*+][ \t]+)?(?:скиллы?|skills?)[ \t]*:[ \t]*([^\n—-]{2,120})[ \t]*(?:—|-)[ \t]*(?:беру|взял(?:а)?|take|использую|применяю|ставлю)/i;
const BLOCK_REASON =
  "skill-gate: перед первым действием в этом ходе нужно одно из трёх: " +
  "(1) открыть профильный скилл через read skill://<имя> (справочник скиллов и триггеров есть в промпте), " +
  "(2) объявить его строкой «скиллы: <имя> — беру <имя>», " +
  "либо (3) явно написать в ответе строку «скиллов нет - причина». " +
  "Сейчас всё это отсутствует - действие заблокировано.";

// Слой 2: статусы обязательств. Форма строки фиксирована, чтобы её можно было разобрать.
// Маркер списка («- », «* ») слева допускается: агент пишет статусы обычным списком.
// Необязательное имя скилла перед id нужно, когда открыто два скилла и их o1..o6 сталкиваются.
const STATUS_LINE =
  /(^|\n)[ \t]*(?:[-*+][ \t]+)?(сделано|неприменимо|не сделано)\s*:\s*(?:([a-z0-9._-]+)[ \t]*\[[ \t]*(o\d+)\b[ \t]*\]|(o\d+)\b)([^\n]*)/gi;
const EVIDENCE_MARK = /(?:доказательство|evidence|подтверждено)\s*:\s*(.+)$/i;
const STOP_BLOCK_LIMIT = 3;
const OBLIGATION_CAP = 6; // пунктов с одного скилла
const TOTAL_OBLIGATION_CAP = 10; // пунктов со всех открытых скиллов: иначе пять скиллов дают тридцать строк

// Заголовки секций, где лежат именно обязательства, а не объяснения
const STEP_SECTION = /(process|процесс|workflow|воркфлоу|steps|шаги|порядок|checklist|чек-лист|алгоритм|процедура|how to|как делать)/i;

type Fact = { tool: string; path?: string; command?: string };
type Obligation = { id: string; text: string; source: "checklist" | "steps" };
type SkillObligations = { skill: string; items: Obligation[] };
type Status = { kind: "done" | "na" | "gap"; evidence?: string; reason?: string };

// Текст assistant-сообщения; content-части проверяются в рантайме
function assistantText(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const m = msg as { role?: unknown; content?: unknown }; // AgentMessage-юнион: role/content - рантайм-данные
  if (m.role !== "assistant" || !Array.isArray(m.content)) return "";
  let out = "";
  for (const part of m.content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; text?: unknown };
    if (p.type === "text" && typeof p.text === "string") out += p.text;
  }
  return out;
}

// Причина после «скиллов нет - ...» в декларации; до 60 символов
function extractDeclReason(text: string): string {
  const m = DECLARED_NO_SKILL.exec(text);
  if (!m) return "";
  const rest = text.slice(m.index + m[0].length).replace(/^[\s:.,-]+/, "");
  const stop = rest.search(/[.\n]/);
  const clip = (stop === -1 ? rest : rest.slice(0, stop)).trim();
  return clip.length > 60 ? `${clip.slice(0, 57)}...` : clip;
}

// Цель действия: string = путь/URI, null = внешнее (bash/mcp/web), undefined = не распознано
function extractTarget(toolName: string, input: unknown): string | null | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  if (toolName === "read" || toolName === "grep" || toolName === "glob" || toolName === "find") {
    const p = i.path;
    return typeof p === "string" ? p : undefined;
  }
  if (toolName === "write") {
    const p = i.path;
    return typeof p === "string" ? p : undefined;
  }
  if (toolName === "ast_edit") {
    const p = i.path ?? i.ast;
    if (typeof p === "string") return p;
    if (Array.isArray(i.paths) && typeof i.paths[0] === "string") return i.paths[0];
    return undefined;
  }
  if (toolName === "edit") {
    const body = i.input;
    if (typeof body !== "string") return undefined;
    const m = body.match(/^\s*\[([^\]#\n]+)#?[\w]*\]?/m);
    return m ? m[1].trim() : undefined;
  }
  if (toolName === "bash" || toolName === "eval" || toolName === "web_search" || toolName === "task") {
    return null;
  }
  if (toolName.startsWith(MCP_PREFIX)) return null;
  return undefined;
}

// Снимает markdown-разметку и обрезает пункт до читаемой длины
function cleanItem(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // ссылки → текст
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:]$/, "")
    .slice(0, 110);
}

// Вытаскивает обязательства из текста SKILL.md: сначала чек-листы, затем нумерованные шаги.
// Код-блоки пропускаются: там примеры и шаблоны, а не требования к работе.
function extractObligations(skillText: string): Obligation[] {
  const lines = skillText.split(/\r?\n/);
  const checklist: string[] = [];
  const scopedSteps: string[] = [];
  const looseSteps: string[] = [];
  let inStepSection = false;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = /^\s{0,3}(#{2,4})\s+(.+)$/.exec(line);
    if (heading) {
      inStepSection = STEP_SECTION.test(heading[2]);
      const numbered = /^\s{0,3}#{2,4}\s+\d+[.)]\s+(.+)$/.exec(line);
      if (numbered) scopedSteps.push(cleanItem(numbered[1]));
      continue;
    }
    // чек-лист: пункт считается обязательством в любом месте файла
    const check = /^\s*[-*]\s*\[[ x]\]\s+(.+)$/.exec(line);
    if (check) {
      checklist.push(cleanItem(check[1]));
      continue;
    }
    const num = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
    if (!num) continue;
    // шаг из «процессной» секции весомее случайного списка в объяснении
    if (inStepSection) scopedSteps.push(cleanItem(num[2]));
    else looseSteps.push(cleanItem(num[2]));
  }

  const source: "checklist" | "steps" = checklist.length >= 2 ? "checklist" : "steps";
  const raw = source === "checklist" ? checklist : scopedSteps.length >= 2 ? scopedSteps : [...scopedSteps, ...looseSteps];
  const seen = new Set<string>();
  const items: Obligation[] = [];
  for (const text of raw) {
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    items.push({ id: `o${items.length + 1}`, text, source });
    if (items.length >= OBLIGATION_CAP) break;
  }
  return items;
}

// Строка для агента: что именно требуется закрыть по этому скиллу
function obligationsNotice(skill: string, items: Obligation[]): string {
  const list = items.map((o) => `[${o.id}] ${o.text}`).join(" · ");
  return (
    `skill-gate: скилл ${skill} несёт обязательства (${items.length}): ${list}. ` +
    `Перед завершением по каждому пункту нужна строка одного из трёх видов: ` +
    `«сделано: ${skill} [${items[0]?.id ?? "o1"}] — доказательство: <путь, команда или цитата из вывода>», ` +
    `«неприменимо: <id> — причина» или «не сделано: <id> — причина». ` +
    `Цитатой считается фрагмент в кавычках, который реально был в выводе инструмента или в ответе. ` +
    `Форма без имени скилла («сделано: ${items[0]?.id ?? "o1"} — …») тоже годится. ` +
    `Маркер списка «- » в начале строки не мешает. ` +
    `Доказательство проверяется по журналу хода: выдуманное не примут.`
  );
}

// Разбор строк статусов из текста ответа
function parseStatuses(text: string): Map<string, Status> {
  const out = new Map<string, Status>();
  STATUS_LINE.lastIndex = 0;
  for (let m = STATUS_LINE.exec(text); m; m = STATUS_LINE.exec(text)) {
    const kind = m[2].toLowerCase() === "сделано" ? "done" : m[2].toLowerCase() === "неприменимо" ? "na" : "gap";
    const skill = (m[3] ?? "").toLowerCase();
    const id = (m[4] ?? m[5] ?? "").toLowerCase();
    if (!id) continue;
    // Ключ: «скилл:oN» для адресной строки, просто «oN» для общей
    const key = skill ? `${skill}:${id}` : id;
    const tail = m[6] ?? "";
    const ev = EVIDENCE_MARK.exec(tail);
    if (kind === "done") {
      out.set(key, { kind, evidence: ev ? ev[1].trim() : "" });
    } else {
      const reason = tail.replace(/^[\s—–:,.-]+/, "").trim();
      out.set(key, { kind, reason: reason.slice(0, 120) });
    }
  }
  return out;
}

// Путь без селектора строк: `design.md:1-40,79-140` и `design.md` это один файл.
// Буква диска (`C:/…`) селектором не считается: после двоеточия там слэш, а не цифра.
function normPath(p: string): string {
  return p
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/:(?=\d|raw\b|conflicts\b|img\b)/, "")
    .replace(/:\d[\d,\-]*$/, "");
}

// Доказательство считается настоящим только по журналу хода.
// Файл и команда ищутся среди фактических вызовов; цитата — в выводе инструментов.
// Возвращает вид доказательства: внешнее (существовало до правки), своё (создано в этом же ходе),
// цитата (была в выводе) либо none — доказательства нет. Собственный текст ответа
// источником не является (R5): иначе агент подтверждает сам себя собственной фразой.
function classifyEvidence(
  evidence: string,
  facts: Fact[],
  existedBefore: Set<string>,
  writtenPaths: Set<string>,
  toolOutputs: string,
): "external" | "self" | "quote" | "none" {
  const clean = evidence.replace(/[`"'«»]/g, "").trim();
  if (clean.length < 3) return "none";
  const outputs = toolOutputs.toLowerCase();
  const quote = /^(?:цитата|quote)\s*:\s*(.+)$/i.exec(clean);
  if (quote) {
    const text = quote[1].replace(/[`"'«»]/g, "").trim();
    if (text.length < 12) return "none"; // короткая фраза ничего не доказывает
    return outputs.includes(text.toLowerCase()) ? "quote" : "none";
  }
  const probe = normPath(clean.slice(0, 80));
  for (const f of facts) {
    for (const value of [f.path, f.command]) {
      if (!value) continue;
      const v = normPath(value);
      if (!(v.includes(probe) || probe.includes(v))) continue;
      // файл, который агент создал в этом ходе и до этого не читал, — своё доказательство
      if (writtenPaths.has(v) && !existedBefore.has(v)) return "self";
      return "external";
    }
  }
  // Цитата без метки: фрагмент в кавычках, который реально был в выводе инструментов.
  // Текст ответа агента здесь НЕ источник: иначе агент подтверждает сам себя,
  // процитировав собственную фразу выше по ходу (R5, дыра закрыта v5.3.1).
  const chunks: string[] = [];
  for (const m of evidence.matchAll(/`([^`]{8,})`/g)) chunks.push(m[1]);
  for (const m of evidence.matchAll(/[«"]([^«»"]{8,})[»"]/g)) chunks.push(m[1]);
  for (const raw of chunks) {
    const text = raw.trim().toLowerCase();
    if (text.length >= 8 && toolOutputs.toLowerCase().includes(text)) return "quote";
  }
  return "none";
}

export default function skillGate(pi: ExtensionAPI): void {
  // Session-scoped (NFR-3): замыкание фабрики, сабагенты не трогают корень.
  let dirty = true; // ход требует скилл или декларацию
  let blocksThisTurn = 0;
  let blocksTotal = 0;
  let openSkills: string[] = []; // имена skill:// прочитанных в этом ходе
  let obligationsBySkill: SkillObligations[] = []; // обязательства открытых скиллов
  let declNoSkill = false; // ход закрыт декларацией «скиллов нет»
  let declReason = ""; // текст причины после «скиллов нет -»
  let facts: Fact[] = []; // факты хода для проверки доказательств
  let existedBefore = new Set<string>(); // файлы, прочитанные до записи (значит, существовали)
  let writtenPaths = new Set<string>(); // файлы, созданные или перезаписанные в этом ходе
  let actionCalls = 0; // вызовы сверх чтения скиллов: отличает работу от справки
  let toolOutputs = ""; // накопленный вывод инструментов: источник цитат для доказательств
  const TOOL_OUTPUT_CAP = 400_000; // символов; дальше не растём
  let statuses = new Map<string, Status>();
  let stopBlocks = 0; // отказов завершения в этом ходе (предохранитель)
  let stopGaveUp = false; // предохранитель сработал

  // FR-5: гейт только для главной сессии (ctx.agent.kind: "main" | "sub")
  const mainOnly = (ctx: ExtensionContext) => ctx.agent?.kind !== "sub";

  // Незакрытые и недоказанные пункты всех открытых скиллов + счётчик видов доказательств
  const unresolved = (): { missing: string[]; unproven: string[]; selfEv: number; extEv: number } => {
    const missing: string[] = [];
    const unproven: string[] = [];
    let selfEv = 0;
    let extEv = 0;
    if (actionCalls === 0) return { missing, unproven, selfEv, extEv }; // ход-справка: только чтение скилла
    for (const group of obligationsBySkill) {
      for (const item of group.items) {
        const st = statuses.get(`${group.skill}:${item.id}`) ?? statuses.get(item.id);
        if (!st) {
          missing.push(`${group.skill} [${item.id}] ${item.text}`);
          continue;
        }
        if (st.kind !== "done") continue;
        const kind = classifyEvidence(
          st.evidence ?? "",
          facts,
          existedBefore,
          writtenPaths,
          toolOutputs,
        );
        if (kind === "none") unproven.push(`${group.skill} [${item.id}] ${item.text}`);
        else if (kind === "self") selfEv += 1;
        else extEv += 1;
      }
    }
    return { missing, unproven, selfEv, extEv };
  };

  // FR-4: новый ход = заново оценка
  pi.on("input", (_event, ctx) => {
    if (!mainOnly(ctx)) return;
    dirty = true;
    blocksThisTurn = 0;
    openSkills = [];
    obligationsBySkill = [];
    declNoSkill = false;
    declReason = "";
    facts = [];
    existedBefore = new Set<string>();
    writtenPaths = new Set<string>();
    actionCalls = 0;
    toolOutputs = "";
    statuses = new Map<string, Status>();
    stopBlocks = 0;
    stopGaveUp = false;
  });

  // FR-2: скилл открыт = read skill:// прошёл успешно; здесь же вытаскиваем его обязательства
  pi.on("tool_result", (event, ctx) => {
    if (!mainOnly(ctx)) return;
    const collected = event.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
    // Вывод инструментов нужен для проверки цитат: это единственный источник фактов,
    // который агент не может выдумать. Копим по всем инструментам, а не только по read.
    if (!event.isError && collected && toolOutputs.length < TOOL_OUTPUT_CAP) {
      toolOutputs += "\n" + collected.slice(0, 8000);
    }
    if (event.toolName !== "read" || event.isError) return;
    const p = event.input?.path;
    const text = collected;

    if (typeof p === "string" && p.startsWith("skill://")) {
      const name = p.slice("skill://".length).split(/[/?#]/)[0];
      if (name && !openSkills.includes(name)) openSkills.push(name);
      // Фоновый скилл открывается всегда, он не выбор: ход остаётся dirty,
      // пока агент не откроет профильный скилл или не задекларирует «скиллов нет».
      if (!BACKGROUND_SKILLS[name]) dirty = false;
      // Обязательства берём только из тела самого скилла.
      // Файл references/ это справка: его оглавление не работа, а описание.
      const isSkillBody = /^skill:\/\/[^/?#]+(?:[/\\]SKILL\.md)?$/i.test(p);
      if (
        isSkillBody &&
        name &&
        text.includes("[Skill file") &&
        !obligationsBySkill.some((g) => g.skill === name)
      ) {
        const items = extractObligations(text);
        const already = obligationsBySkill.reduce((n, g) => n + g.items.length, 0);
        const room = TOTAL_OBLIGATION_CAP - already;
        const take = items.slice(0, Math.max(0, room));
        if (take.length > 0) {
          obligationsBySkill.push({ skill: name, items: take });
          return { additionalContext: obligationsNotice(name, take) };
        }
      }
      return;
    }
    if (text.includes("[Skill file")) dirty = false;
  });

  // FR-3: декларация «скиллов нет»; слой 2: статусы из текста ответа
  pi.on("message_update", (event, ctx) => {
    if (!mainOnly(ctx)) return;
    const text = assistantText(event.message);
    if (!text) return;
    statuses = parseStatuses(text);
    if (!dirty) return;
    if (DECLARED_NO_SKILL.test(text)) {
      dirty = false;
      declNoSkill = true;
      declReason = extractDeclReason(text);
      return;
    }
    // R10: «скиллы: X, Y — беру X». Все имена фоновые - модель заявила фоновую
    // нагрузку, профильного выбора нет (эквивалент «скиллов нет»). Есть нефоновое -
    // заявка, не исполнение: ждём read skill://<имя>, чтобы слой 2 получил обязательства.
    const declared = DECLARED_SKILL_LINE.exec(text);
    if (declared) {
      // declared[1] — это (^|\n) из якоря, пустой на первой строке; имена в declared[2]
      const names = declared[2].split(/[,;/]\s*/).map((s) => s.trim()).filter(Boolean);
      if (names.length > 0 && names.every((n) => BACKGROUND_SKILLS[n])) {
        dirty = false;
        declNoSkill = true;
        declReason = `строка выбора: ${names.join(", ")}`;
      }
    }
  });

  // FR-1: блок действий, пока ход грязный; R2.1: сбор фактов для проверки доказательств
  pi.on("tool_call", (event, ctx) => {
    if (!mainOnly(ctx)) return;
    const tn = event.toolName;
    const target = extractTarget(tn, event.input);
    const command = tn === "bash" ? (event.input as { command?: unknown } | undefined)?.command : undefined;
    facts.push({
      tool: tn,
      path: typeof target === "string" ? target : undefined,
      command: typeof command === "string" ? command : undefined,
    });
    // чтение скиллов и внутренних адресов — не работа, а справка
    const isReference =
      (tn === "read" && typeof target === "string" && (target.startsWith("skill://") || INTERNAL_SCHEME.test(target)));
    if (!isReference) actionCalls += 1;

    // классификация доказательств: что существовало до правки, а что создано в этом ходе
    if (typeof target === "string" && !INTERNAL_SCHEME.test(target)) {
      const norm = normPath(target);
      if (tn === "read" || tn === "grep" || tn === "glob" || tn === "find") {
        if (!writtenPaths.has(norm)) existedBefore.add(norm);
      } else if (tn === "write" || tn === "ast_edit") {
        writtenPaths.add(norm);
      }
    }

    if (!(tn in GATED_TOOLS) && !tn.startsWith(MCP_PREFIX)) return;
    if (!dirty) return;
    // Открытие скилла всегда пропускается (иначе петля)
    if (typeof target === "string" && target.startsWith("skill://")) return;
    // Внутренние URI omp не блокируются (FR-6)
    if (typeof target === "string" && INTERNAL_SCHEME.test(target)) return;
    // null (bash/mcp/web) или undefined (не распознано) или внешний файл — блок
    blocksThisTurn += 1;
    blocksTotal += 1;
    if (target === undefined) {
      return {
        block: true,
        reason: `skill-gate: не удалось распознать цель инструмента ${tn}. Перед действием открой скилл (read skill://<имя>) или напиши «скиллов нет - причину».`,
      };
    }
    return { block: true, reason: BLOCK_REASON };
  });

  // R4: запрет завершения, пока обязательства не закрыты или не доказаны
  pi.on("session_stop", (_event, ctx) => {
    if (!mainOnly(ctx)) return;
    const { missing, unproven } = unresolved();
    if (missing.length === 0 && unproven.length === 0) return;
    if (stopBlocks >= STOP_BLOCK_LIMIT) {
      // R4.2: предохранитель, дальше не блокируем
      stopGaveUp = true;
      ctx.ui.notify?.(
        `skill-gate: НЕ ПРИНЯТО · ${[...missing, ...unproven].join(" · ")} · гейт сдался после ${STOP_BLOCK_LIMIT} отказов`,
        "warning",
      );
      return;
    }
    stopBlocks += 1;
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`без статуса: ${missing.join("; ")}`);
    if (unproven.length > 0) parts.push(`статус «сделано» без подтверждения в журнале: ${unproven.join("; ")}`);
    return {
      decision: "block",
      reason:
        `skill-gate: обязательства открытого скилла не закрыты. ${parts.join(". ")}. ` +
        `Для каждого пункта нужна строка «сделано: <id> — доказательство: <артефакт>», ` +
        `«неприменимо: <id> — причина» или «не сделано: <id> — причина». ` +
        `Доказательство должно быть настоящим: путь, команда или цитата, реально бывшие в этом ходе. ` +
        `После ${STOP_BLOCK_LIMIT} отказов гейт перестанет блокировать и покажет карточку «НЕ ПРИНЯТО».`,
    };
  });

  // FR-7: сводка по скиллам и обязательствам после ответа агента
  pi.on("agent_end", (_event, ctx) => {
    if (!mainOnly(ctx)) return;
    const parts: string[] = [`блоков: ${blocksThisTurn}`];
    if (openSkills.length > 0) parts.push(`скиллы: ${openSkills.join(", ")}`);
    else if (declNoSkill) parts.push(`скиллов нет: ДЕКЛАРАЦИЯ, скилл не открыт${declReason ? ` (${declReason})` : ""}`);
    else parts.push("без скилла и без декларации");
    if (blocksThisTurn > 0 && dirty) {
      parts.push(`ШТРАФ: ход не вымыт, блоков ${blocksThisTurn}`);
    }
    const total = obligationsBySkill.reduce((n, g) => n + g.items.length, 0);
    if (total > 0 && actionCalls > 0) {
      const { missing, unproven, selfEv, extEv } = unresolved();
      let gaps = 0;
      for (const group of obligationsBySkill) {
        for (const item of group.items) if (statuses.get(item.id)?.kind === "gap") gaps += 1;
      }
      parts.push(`обязательства: закрыто ${total - missing.length - unproven.length}/${total}`);
      if (selfEv + extEv > 0) parts.push(`доказательства: внешних ${extEv}, своих ${selfEv}`);
      if (gaps > 0) parts.push(`честных пробелов: ${gaps}`);
      if (stopGaveUp) parts.push(`НЕ ПРИНЯТО: ${[...missing, ...unproven].join(" · ")}`);
    } else if (total > 0) {
      parts.push(`обязательства: ${total} (ход-справка, статусы не требуются)`);
    }
    ctx.ui.notify?.(`skill-gate: ${parts.join(" · ")}`, "info");
  });

  // FR-8: статус
  pi.registerCommand("skill-gate", {
    description: "skill-gate: состояние гейта, блоки за ход и всего, незакрытые обязательства",
    handler: async (_args, ctx) => {
      const { missing, unproven, selfEv, extEv } = unresolved();
      const total = obligationsBySkill.reduce((n, g) => n + g.items.length, 0);
      const tail =
        total === 0
          ? ""
          : ` · обязательства ${total - missing.length - unproven.length}/${total}` +
            (selfEv + extEv > 0 ? ` · доказательства: внешних ${extEv}, своих ${selfEv}` : "") +
            (missing.length > 0 ? ` · без статуса: ${missing.join(" · ")}` : "") +
            (unproven.length > 0 ? ` · без доказательства: ${unproven.join(" · ")}` : "");
      ctx.ui.notify(
        `skill-gate: ход ${dirty ? "dirty (нужен скилл или «скиллов нет»)" : "clean"} · blocked this turn: ${blocksThisTurn} · total: ${blocksTotal} · отказов завершения: ${stopBlocks}/${STOP_BLOCK_LIMIT}${tail}`,
        "info",
      );
    },
  });
}
