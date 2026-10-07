import { useEffect, useMemo, useRef, useState } from "react";
import type { Api } from "../api";
import { NoteSheet } from "../components/ItemSheets";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { fmtShortDate, fmtTime } from "../format";
import { makeNotesLoader, type NotesState } from "../notesFeed";
import type { Note } from "../types";

export function Notes({ api, refresh = 0 }: { api: Api; refresh?: number }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
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

  return (
    <>
      <input className="search" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && notes.length === 0 ? <ErrorCard onRetry={() => loader.search(query)} />
        : loading && notes.length === 0 ? <Loading />
        : notes.length === 0 ? <Empty title={query ? "Ничего не нашлось" : "Мыслей пока нет"} hint={query ? undefined : "Скажи боту «идея: …»"} />
        : (
          <>
            {notes.map((n) => (
              <button type="button" key={n.id} className="op-row" onClick={() => setEditing(n)}>
                <Card>
                  <div className="note-meta">
                    <span className={`kind ${n.kind}`}>{n.kind === "journal" ? "Дневник" : "Мысль"}</span>
                    <span>{fmtShortDate(n.created_at)}, {fmtTime(n.created_at)}</span>
                  </div>
                  <div className={`note-text ${n.kind}`}>{n.text}</div>
                </Card>
              </button>
            ))}
            {error && <div className="sub">Не удалось загрузить ещё — нажми ещё раз</div>}
            {next && <button type="button" className="button wide" disabled={loading} onClick={() => loader.more()}>{loading ? "Загрузка…" : "Показать ещё"}</button>}
          </>
        )}
      {editing && <NoteSheet api={api} item={editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); loader.search(query); }} />}
    </>
  );
}
