import { useMemo, useState } from "react";
import { makeApi } from "./api";
import { Composer } from "./components/Composer";
import { IconHabits, IconMoney, IconNotes, IconTasks, IconToday } from "./components/Icons";
import { FullScreenMessage, Loading } from "./components/States";
import { TabBar } from "./components/TabBar";
import { useLoad } from "./load";
import { Habits } from "./screens/Habits";
import { Money } from "./screens/Money";
import { Notes } from "./screens/Notes";
import { Tasks } from "./screens/Tasks";
import { Today } from "./screens/Today";
import { screenForState } from "./state";
import { tg } from "./telegram";

const TABS = [
  { key: "today", label: "Сегодня", icon: <IconToday /> },
  { key: "tasks", label: "Задачи", icon: <IconTasks /> },
  { key: "money", label: "Деньги", icon: <IconMoney /> },
  { key: "habits", label: "Привычки", icon: <IconHabits /> },
  { key: "notes", label: "Мысли", icon: <IconNotes /> },
];

export default function App() {
  const initData = tg?.initData ?? "";
  const api = useMemo(() => makeApi(import.meta.env.VITE_API_URL ?? "", initData), [initData]);
  const me = useLoad(() => (initData ? api.me() : Promise.resolve(null)), [api]);
  const [tab, setTab] = useState("today");
  const [refresh, setRefresh] = useState(0);

  const screen = screenForState({ initData, error: me.error });
  if (screen === "outside") return <FullScreenMessage title="Открой планер из Telegram" hint="Кнопка «📱 Приложение» в боте" />;
  if (screen === "relaunch") return <FullScreenMessage title="Перезапусти миниапп" hint="Сессия устарела" />;
  if (screen === "noaccess") return <FullScreenMessage title="Нет доступа" hint="Напиши боту /start" />;
  if (screen === "network") return <FullScreenMessage title="Нет связи" hint="Проверь интернет и открой снова" action={{ label: "Повторить", onClick: me.reload }} />;
  if (me.loading || !me.data) return <main className="page"><Loading /></main>;

  return (
    <>
      <main className="page">
        <h1>{TABS.find((t) => t.key === tab)!.label}</h1>
        {tab === "today" && <Today api={api} me={me.data} refresh={refresh} />}
        {tab === "tasks" && <Tasks api={api} me={me.data} refresh={refresh} />}
        {tab === "money" && <Money api={api} me={me.data} refresh={refresh} />}
        {tab === "habits" && <Habits api={api} refresh={refresh} />}
        {tab === "notes" && <Notes api={api} refresh={refresh} />}
      </main>
      <div className="dock">
        <Composer api={api} onDone={() => setRefresh((n) => n + 1)} />
        <TabBar tabs={TABS} active={tab} onChange={setTab} />
      </div>
    </>
  );
}
