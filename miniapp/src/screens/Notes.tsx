import { useEffect, useMemo, useRef, useState } from "react";
import type { Api } from "../api";
import { NoteSheet } from "../components/ItemSheets";
import { Segmented } from "../components/Segmented";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { fmtShortDate, fmtTime } from "../format";
import { makeNotesLoader, type NotesState } from "../notesFeed";
import type { Note } from "../types";

type Kind = "all" | "thought" | "journal";
const KIND_FILTERS: { key: Kind; label: string }[] = [
  { key: "all", label: "Всё" },
  { key: "thought", label: "Мысли" },
  { key: "journal", label: "Дневник" },
];

export function Notes({ api, refresh = 0, onAdd }: { api: Api; refresh?: number; onAdd: () => void }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [state, setState] = useState<NotesState>({ notes: [], next: null, loading: true, error: false });
  const loader = useMemo(() => makeNotesLoader((qq, before) => api.notes(qq, before), setState), [api]);
  const { notes, next, loading, error } = state;
  const [editing, setEditing] = useState<Note | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { loader.search(query); }, [loader, query]);
  const seen = useRef(refresh);
  useEffect(() => {
    if (refresh === seen.current) return;
    seen.current = refresh;
    loader.search(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  // Фильтр по типу — на клиенте: сервер уже прислал страницу, второй запрос ни к чему.
  const shown = kind === "all" ? notes : notes.filter((n) => n.kind === kind);

  return (
    <>
      <input className="search" placeholder="Поиск по заметкам" value={q}
        onChange={(e) => setQ(e.target.value)} aria-label="Поиск по заметкам" />
      <Segmented items={KIND_FILTERS} value={kind} onChange={setKind} label="Тип заметок" />

      {error && notes.length === 0 ? <ErrorCard onRetry={() => loader.search(query)} />
        : loading && notes.length === 0 ? <Loading />
        : shown.length === 0
        ? <Empty
            title={query ? "Ничего не нашлось" : kind === "journal" ? "Записей в дневнике нет" : "Заметок пока нет"}
            hint={query ? "Попробуй другое слово" : "Надиктуй боту «идея: …» — или добавь вручную"}
            action={query ? undefined : { label: "Добавить заметку", onClick: onAdd }}
          />
        : (
          <>
            {shown.map((n) => (
              <button type="button" key={n.id} className="tapcard" onClick={() => setEditing(n)}>
                <Card>
                  <div className="note-meta">
                    <span className={`kind ${n.kind}`}>{n.kind === "journal" ? "Дневник" : "Мысль"}</span>
                    <span>{fmtShortDate(n.created_at)}, {fmtTime(n.created_at)}</span>
                  </div>
                  <div className="note-text clamp2">{n.text}</div>
                </Card>
              </button>
            ))}
            {error && <div className="sub danger">Не удалось загрузить ещё — нажми снова</div>}
            {next && (
              <button type="button" className="btn ghost wide" disabled={loading} onClick={() => loader.more()}>
                {loading ? "Загрузка…" : "Показать ещё"}
              </button>
            )}
          </>
        )}

      {editing && (
        <NoteSheet api={api} item={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loader.search(query); }} />
      )}
    </>
  );
}
