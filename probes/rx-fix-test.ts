const STATUS_LINE =
  /(^|\n)[ \t]*(?:[-*+][ \t]+)?(сделано|неприменимо|не сделано)\s*:\s*(?:([a-z0-9._-]+)[ \t]*\[[ \t]*(o\d+)\b[ \t]*\]|(o\d+)\b)([^\n]*)/gi;

function parse(text: string) {
  const out: string[] = [];
  STATUS_LINE.lastIndex = 0;
  for (let m = STATUS_LINE.exec(text); m; m = STATUS_LINE.exec(text)) {
    const skill = (m[3] ?? "").toLowerCase();
    const id = (m[4] ?? m[5] ?? "").toLowerCase();
    out.push(`${skill ? skill + ":" : ""}${id}=${m[2]}`);
  }
  return out;
}

const cases: Array<[string, string, string]> = [
  ["маркер списка", "- сделано: o1 — доказательство: `strings.js`", "o1=сделано"],
  ["звёздочка", "* неприменимо: o2 — причина: нечего", "o2=неприменимо"],
  ["вложенный список", "  - сделано: o3 — доказательство: README.md", "o3=сделано"],
  ["имя скилла в скобках", "- сделано: documentation-authoring [o1] — доказательство: README.md", "documentation-authoring:o1=сделано"],
  ["имя и запятая", "сделано: documentation-authoring [o4], доказательство: README.md", "documentation-authoring:o4=сделано"],
  ["без маркера", "сделано: o5 — доказательство: `ls -1`", "o5=сделано"],
  ["не сделано", "- не сделано: o6 — причина: нет данных", "o6=не сделано"],
  ["не статус", "В отчёте: сделано многое", ""],
  ["несколько строк", "- сделано: o1 — доказательство: a\n- неприменимо: o2 — причина: b", "o1=сделано|o2=неприменимо"],
];

let pass = 0;
for (const [name, text, expect] of cases) {
  const got = parse(text).join("|");
  const ok = got === expect;
  if (ok) pass++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: получил «${got}», ждал «${expect}»`);
}
console.log(`\n${pass}/${cases.length}`);
