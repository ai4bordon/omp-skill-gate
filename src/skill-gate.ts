// skill-gate: надсмотрщик скиллов для OMP. Жёсткий гейт: в ходе нельзя
// выполнять ANY действие (чтение, поиск, правка, bash, MCP, web) до открытия
// скилла (read skill://) или явной декларации «скиллов нет» в ответе.
// Спека: .kiro/specs/skill-gate/. v2: шире, + чтение/разведка/MCP/bash.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

// ---- конфиг (NFR-2: одно место) ----
const GATED_TOOLS: Record<string, true> = {
  edit: true, write: true, ast_edit: true,
  read: true, grep: true, glob: true, find: true,
  bash: true, eval: true, web_search: true, task: true,
};
const MCP_PREFIX = "mcp__";
// Внутренние схемы: правки по ним гейтом не считаются (FR-6)
const INTERNAL_SCHEME = /^(xd|local|agent|mcp|proc|skill|omp|ssh|issue|pr|cfg|security|history|artifact|db)[\w.-]*:/i;
// Декларация «скиллов нет» - строка в начале строки ответа (FR-3)
const DECLARED_NO_SKILL = /(^|\n)\s*(скиллов?\s+нет|no\s+(applicable\s+|matching\s+|relevant\s+)?skills?)/mi;
const BLOCK_REASON =
  "skill-gate: перед первым действием в этом ходе нужно одно из двух: " +
  "(1) открыть профильный скилл через read skill://<имя> (справочник скиллов и триггеров есть в промпте), " +
  "либо (2) явно написать в ответе строку «скиллов нет - причина». " +
  "Сейчас и то, и другое отсутствует - действие заблокировано.";

// Текст assistant-сообщения; content-части проверяются в рантайме
function assistantText(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const m = msg as { role?: unknown; content?: unknown }; // AgentMessage-юнион: role/content - рантайм-данные
  if (m.role !== "assistant" || !Array.isArray(m.content)) return "";
  let out = "";
  for (const part of m.content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; text?: unknown }; // content-часть: text - рантайм-данные
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
  // Файловые/поисковые: поле path
  if (toolName === "read" || toolName === "grep" || toolName === "glob" || toolName === "find") {
    const p = i.path;
    return typeof p === "string" ? p : undefined;
  }
  // Запись: те же поля, что в v1
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
  // Внешние действия без файловой цели: bash, eval, web_search, task, MCP
  if (toolName === "bash" || toolName === "eval" || toolName === "web_search" || toolName === "task") {
    return null;
  }
  if (toolName.startsWith(MCP_PREFIX)) return null;
  return undefined;
}

export default function skillGate(pi: ExtensionAPI): void {
  // Session-scoped (NFR-3): замыкание фабрики, сабагенты не трогают корень.
  let dirty = true; // ход требует скилл или декларацию
  let blocksThisTurn = 0;
  let blocksTotal = 0;
  let openSkills: string[] = []; // имена skill:// прочитанных в этом ходе
  let declNoSkill = false; // ход закрыт декларацией «скиллов нет»
  let declReason = ""; // текст причины после «скиллов нет -»

  // FR-5: гейт только для главной сессии (ctx.agent.kind: "main" | "sub")
  const mainOnly = (ctx: ExtensionContext) => ctx.agent?.kind !== "sub";

  // FR-4: новый ход = заново оценка
  pi.on("input", (_event, ctx) => {
    if (!mainOnly(ctx)) return;
    dirty = true;
    blocksThisTurn = 0;
    openSkills = [];
    declNoSkill = false;
    declReason = "";
  });

  // FR-2: скилл открыт = read skill:// прошёл успешно
  pi.on("tool_result", (event, ctx) => {
    if (!mainOnly(ctx)) return;
    if (event.toolName !== "read" || event.isError) return;
    const p = event.input?.path;
    if (typeof p === "string" && p.startsWith("skill://")) {
      const name = p.slice("skill://".length).split(/[/?#]/)[0];
      if (name && !openSkills.includes(name)) openSkills.push(name);
      dirty = false;
      return;
    }
    const text = event.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
    if (text.includes("[Skill file")) dirty = false;
  });

  // FR-3: декларация «скиллов нет» в стриме ответа
  pi.on("message_update", (event, ctx) => {
    if (!mainOnly(ctx) || !dirty) return;
    const m = DECLARED_NO_SKILL.exec(assistantText(event.message));
    if (m) {
      dirty = false;
      declNoSkill = true;
      declReason = extractDeclReason(assistantText(event.message));
    }
  });

  // FR-1: блок действий, пока ход грязный
  pi.on("tool_call", (event, ctx) => {
    if (!mainOnly(ctx)) return;
    const tn = event.toolName;
    if (!(tn in GATED_TOOLS) && !tn.startsWith(MCP_PREFIX)) return;
    if (!dirty) return;
    const target = extractTarget(tn, event.input);
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

  // FR-7: сводка по скиллам после ответа агента (agent_end = конец обработки запроса,
  // один раз; turn_end эмитится на каждый модельный шаг - не подходит)
  pi.on("agent_end", (_event, ctx) => {
    if (!mainOnly(ctx)) return;
    const parts: string[] = [`блоков: ${blocksThisTurn}`];
    if (openSkills.length > 0) parts.push(`скиллы: ${openSkills.join(", ")}`);
    else if (declNoSkill) parts.push(`скиллов нет: ДЕКЛАРАЦИЯ, скилл не открыт${declReason ? ` (${declReason})` : ""}`);
    else parts.push("без скилла и без декларации");
    if (blocksThisTurn > 0 && dirty) {
      parts.push(`ШТРАФ: ход не вымыт, блоков ${blocksThisTurn}`);
    }
    ctx.ui.notify?.(`skill-gate: ${parts.join(" · ")}`, "info");
  });

  // FR-8: статус
  pi.registerCommand("skill-gate", {
    description: "skill-gate: состояние гейта, блоки за ход и всего",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `skill-gate: ход ${dirty ? "dirty (нужен скилл или «скиллов нет»)" : "clean"} · blocked this turn: ${blocksThisTurn} · total: ${blocksTotal}`,
        "info",
      );
    },
  });
}
