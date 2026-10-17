// Нагрузочный тест API planner: число одновременных пользователей растёт ступенями от 10,
// пока сервис не начнёт тормозить или сыпать ошибками. Запуск — loadtest/run.sh.
//
// Один виртуальный пользователь ведёт себя как человек в миниаппе: открывает его
// (4 запроса разом, как App.tsx), смотрит одну из вкладок, иногда что-то записывает,
// и между действиями думает 1–3 секунды.
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

const BASE = __ENV.BASE_URL || "http://metrics-proxy:8787/api";
const users = new SharedArray("users", () => JSON.parse(open("./users.json")));

// Ступени: 10 → 300 пользователей, каждая держится 45 с, чтобы метрики успели устояться.
const STEPS = (__ENV.STEPS || "10,20,40,60,80,100,130,160,200,250,300").split(",").map(Number);
const HOLD = __ENV.HOLD || "45s";
const stages = STEPS.flatMap((target) => [{ duration: "10s", target }, { duration: HOLD, target }]);

export const options = {
  scenarios: {
    ramp: { executor: "ramping-vus", startVUs: 0, stages, gracefulRampDown: "10s", gracefulStop: "15s" },
  },
  // 429 от лимитов и любые 5xx — это провал запроса
  thresholds: {
    // явно сломалось — останавливаемся, дальше гонять бессмысленно
    http_req_failed: [{ threshold: "rate<0.2", abortOnFail: true, delayAbortEval: "30s" }],
    http_req_duration: [{ threshold: "p(95)<8000", abortOnFail: true, delayAbortEval: "30s" }],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const think = (min, max) => sleep(min + Math.random() * (max - min));

export default function () {
  if (__VU > users.length) throw new Error(`пользователей в users.json (${users.length}) меньше, чем VU`);
  const headers = { "x-init-data": users[__VU - 1], "content-type": "application/json" };
  const get = (path, name) => ({ method: "GET", url: `${BASE}${path}`, params: { headers, tags: { name } } });
  const post = (path, body, name) => http.post(`${BASE}${path}`, JSON.stringify(body), { headers, tags: { name } });
  const ok = (res, what) => check(res, { [`${what} 2xx`]: (r) => r.status >= 200 && r.status < 300 });

  // открыл миниапп
  for (const r of http.batch([get("/me", "/me"), get("/today", "/today"), get("/subscription", "/subscription"),
                              get("/settings", "/settings")])) ok(r, "open");
  think(1, 3);

  // посмотрел вкладку
  const month = today().slice(0, 7);
  const tabs = [
    get("/tasks?filter=today", "/tasks"),
    get(`/money?month=${month}`, "/money"),
    get("/habits?weeks=4", "/habits"),
    get(`/events?from=${today()}&to=${plusDays(7)}`, "/events"),
    get("/notes", "/notes"),
    get(`/operations?month=${month}`, "/operations"),
  ];
  const tab = tabs[Math.floor(Math.random() * tabs.length)];
  ok(http.request(tab.method, tab.url, null, tab.params), "tab");
  think(1, 3);

  // каждый второй раз что-то записал
  if (Math.random() < 0.5) {
    if (Math.random() < 0.5) {
      const r = post("/tasks", { title: "Нагрузка", due_date: today() }, "POST /tasks");
      if (ok(r, "create task")) {
        think(0.5, 1.5);
        ok(post(`/tasks/${r.json("id")}/done`, { done: true }, "POST /tasks/:id/done"), "done");
      }
    } else {
      ok(post("/transactions", { type: "expense", amount: 350, title: "Кофе", category: "кафе" }, "POST /transactions"), "expense");
    }
    think(1, 2);
  }
}

export function handleSummary(data) {
  return { "/scripts/results/summary.json": JSON.stringify(data, null, 2) };
}
