import { assertEquals } from "jsr:@std/assert@1";
import { ARG_NAMES } from "./db.ts";

// Тесты handler подменяют базу двойником, поэтому функция без записи в ARG_NAMES
// проходила тесты и падала только в проде («unknown rpc»). Сверяем исходник с картой.
// Нужен --allow-read (читает миграции); без него тест пропускается, а не падает.
const canRead = (await Deno.permissions.query({ name: "read" })).state === "granted";

Deno.test({ name: "every DB function the API calls has its argument names mapped", ignore: !canRead }, async () => {
  const migrations = new URL("../../migrations/", import.meta.url);
  const dbFns = new Set<string>();
  for await (const f of Deno.readDir(migrations)) {
    const sql = await Deno.readTextFile(new URL(f.name, migrations));
    for (const m of sql.matchAll(/function public\.([a-z_]+)\(/g)) dbFns.add(m[1]);
  }
  const src = await Deno.readTextFile(new URL("./handler.ts", import.meta.url));
  const used = [...new Set([...src.matchAll(/"([a-z]+(?:_[a-z]+)+)"/g)].map((m) => m[1]))]
    .filter((name) => dbFns.has(name));
  assertEquals(used.filter((fn) => !Object.hasOwn(ARG_NAMES, fn)), []);
});
