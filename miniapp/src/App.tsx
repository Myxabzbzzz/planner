import { useMemo, useState } from "react";
import { makeApi } from "./api";
import { Masthead } from "./components/Brand";
import { Composer } from "./components/Composer";
import { IconHabits, IconMoney, IconNotes, IconTasks, IconToday } from "./components/Icons";
import { NewSheet, type NewKind } from "./components/NewSheet";
import { SettingsSheet } from "./components/SettingsSheet";
import { FullScreenMessage, Loading } from "./components/States";
import { TabBar } from "./components/TabBar";
import { useLoad } from "./load";
import { Habits } from "./screens/Habits";
import { Money } from "./screens/Money";
import { Notes } from "./screens/Notes";
import { Profile } from "./screens/Profile";
import { Tasks } from "./screens/Tasks";
import { Today } from "./screens/Today";
import { screenForState } from "./state";
import { tg, useBackButton } from "./telegram";
import type { Settings } from "./types";
import { DEV_BASE, devFetch } from "./devMock";

// Dev-only: вне Telegram нет initData, поэтому в обычном браузере поднимается фейковый бэкенд.
// В production `import.meta.env.DEV` false, и эта ветка вместе с моком выбрасывается из сборки.
const DEV_MOCK = import.meta.env.DEV && !tg?.initData;

const TABS = [
  { key: "today", label: "Сегодня", icon: <IconToday /> },
  { key: "tasks", label: "Задачи", icon: <IconTasks /> },
  { key: "money", label: "Деньги", icon: <IconMoney /> },
  { key: "habits", label: "Привычки", icon: <IconHabits /> },
  { key: "notes", label: "Заметки", icon: <IconNotes /> },
];

const TITLES: Record<string, string> = {
  today: "Сегодня", tasks: "Задачи", money: "Деньги", habits: "Привычки", notes: "Заметки", profile: "Профиль",
};

export default function App() {
  const initData = DEV_MOCK ? "dev" : tg?.initData ?? "";
  const apiUrl = DEV_MOCK ? DEV_BASE : (import.meta.env.VITE_API_URL ?? "");
  const api = useMemo(
    () => makeApi(apiUrl, initData, DEV_MOCK ? devFetch : undefined),
    [apiUrl, initData],
  );
  const me = useLoad(() => (initData && apiUrl ? api.me() : Promise.resolve(null)), [api]);
  const [tab, setTab] = useState("today");
  const [refresh, setRefresh] = useState(0);
  const [adding, setAdding] = useState<NewKind | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const bump = () => setRefresh((n) => n + 1);

  // Профиль — отдельный слой: системная «Назад» возвращает на вкладку, а не закрывает миниапп.
  useBackButton(tab === "profile" ? () => setTab("today") : null);

  // Миниапп без VITE_API_URL раньше падал внутри `new URL("")` и показывал «Нет связи».
  if (!DEV_MOCK && !apiUrl) {
    return <FullScreenMessage title="Миниапп не настроен" hint="Не задан адрес API (VITE_API_URL) — нужно пересобрать приложение" />;
  }

  const screen = screenForState({ initData, error: me.error });
  if (screen === "outside") {
    return <FullScreenMessage title="Открой планер из Telegram" hint="Кнопка «📱 Приложение» в чате бота" />;
  }
  if (screen === "relaunch") return <FullScreenMessage title="Сессия устарела" hint="Закрой и открой планер заново" />;
  if (screen === "noaccess") return <FullScreenMessage title="Нет доступа" hint="Напиши боту /start" />;
  if (screen === "server") {
    return (
      <FullScreenMessage title="Сервер не отвечает" hint="Это не твой интернет — что-то сломалось на стороне планера"
        action={{ label: "Повторить", onClick: me.reload }} />
    );
  }
  if (screen === "network") {
    return (
      <FullScreenMessage title="Нет связи" hint="Проверь интернет и попробуй снова"
        action={{ label: "Повторить", onClick: me.reload }} />
    );
  }
  if (me.loading || !me.data) return <main className="page"><Loading hero /></main>;

  const openSettings = async () => {
    setSettingsOpen(true);
    if (settings === null) {
      try {
        setSettings(await api.settings());
      } catch {
        setSettingsOpen(false);
      }
    }
  };

  return (
    <>
      <main className="page">
        <Masthead name={me.data.name} onProfile={() => setTab(tab === "profile" ? "today" : "profile")} />
        <h1>{TITLES[tab]}</h1>

        {tab === "today" && (
          <Today api={api} me={me.data} refresh={refresh} onAdd={() => setAdding("task")} onMoney={openSettings} />
        )}
        {tab === "tasks" && <Tasks api={api} me={me.data} refresh={refresh} onAdd={() => setAdding("task")} />}
        {tab === "money" && (
          <Money api={api} me={me.data} refresh={refresh} onAdd={() => setAdding("expense")} onSettings={openSettings} />
        )}
        {tab === "habits" && <Habits api={api} me={me.data} refresh={refresh} onAdd={() => setAdding("habit")} />}
        {tab === "notes" && <Notes api={api} refresh={refresh} onAdd={() => setAdding("note")} />}
        {tab === "profile" && <Profile api={api} refresh={refresh} onSettings={openSettings} />}
      </main>

      <div className="dock">
        <div className="dock-inner">
          <Composer api={api} onDone={bump} onAdd={() => setAdding("task")} />
        </div>
        <TabBar tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {adding !== null && (
        <NewSheet
          api={api}
          tz={me.data.tz}
          currency={me.data.base_currency}
          kind={adding}
          onClose={() => setAdding(null)}
          onSaved={() => { setAdding(null); bump(); }}
        />
      )}

      {settingsOpen && settings !== null && (
        <SettingsSheet
          api={api}
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onChanged={(s) => { setSettings(s); bump(); }}
        />
      )}
    </>
  );
}
