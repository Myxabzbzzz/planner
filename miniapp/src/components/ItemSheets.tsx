import { useState, type ReactNode } from "react";
import type { Api } from "../api";
import { buildEventPatch, buildHabitPatch, buildNotePatch, buildTaskPatch, splitDue, type NoteKind } from "../itemEdit";
import { ApiError } from "../api";
import { confirmDialog, hapticResult } from "../telegram";
import { IconClose } from "./Icons";

type Base<T> = { api: Api; item: T; onClose: () => void; onSaved: () => void };

function useRun(onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      hapticResult(true);
      onSaved();
    } catch (e) {
      hapticResult(false);
      setError(e instanceof ApiError && e.status === 400 ? "Проверь поля." : "Не удалось сохранить. Попробуй ещё раз.");
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function Frame({ title, busy, error, invalid, canSave, onSave, removeLabel, onRemove, onClose, children }: {
  title: string; busy: boolean; error: string | null; invalid: boolean; canSave: boolean; onSave: () => void;
  removeLabel: string; onRemove: () => void; onClose: () => void; children: ReactNode;
}) {
  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="sheet-title">{title}</span>
          <button type="button" className="sheet-close" onClick={onClose} disabled={busy} aria-label="Закрыть"><IconClose /></button>
        </div>
        {children}
        {invalid && <div className="danger sub">Проверь поля.</div>}
        {error && <div className="danger sub">{error}</div>}
        <button type="button" className="button wide" onClick={onSave} disabled={busy || !canSave}>
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
        <button type="button" className="button wide ghost-danger" onClick={onRemove} disabled={busy}>{removeLabel}</button>
      </div>
    </div>
  );
}

export function TaskSheet({ api, item, onClose, onSaved }: Base<{ id: string; title: string; due: string | null }>) {
  const was = splitDue(item.due);
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState(was.date);
  const [time, setTime] = useState(was.time);
  const { busy, error, run } = useRun(onSaved);
  const patch = buildTaskPatch(item, { title, date, time });
  return (
    <Frame title="Задача" busy={busy} error={error} invalid={patch === "invalid"} canSave={!!patch && patch !== "invalid"}
      onSave={() => { if (patch && patch !== "invalid") void run(() => api.updateTask(item.id, patch)); }}
      removeLabel="Удалить" onClose={onClose}
      onRemove={async () => { if (await confirmDialog("Удалить задачу?")) void run(() => api.deleteTask(item.id)); }}>
      <label className="field"><span>Название</span>
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={busy} /></label>
      <label className="field"><span>Срок</span>
        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); if (!e.target.value) setTime(""); }} disabled={busy} /></label>
      {date && (
        <label className="field"><span>Время (необязательно)</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} /></label>
      )}
      {date && <button type="button" className="pill" onClick={() => { setDate(""); setTime(""); }} disabled={busy}>Без срока</button>}
    </Frame>
  );
}

export function EventSheet({ api, item, onClose, onSaved }:
  Base<{ id: string; title: string; date: string; time: string; with_whom: string | null }>) {
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState(item.date);
  const [time, setTime] = useState(item.time);
  const [withWhom, setWithWhom] = useState(item.with_whom ?? "");
  const { busy, error, run } = useRun(onSaved);
  const patch = buildEventPatch(item, { title, date, time, withWhom });
  return (
    <Frame title="Встреча" busy={busy} error={error} invalid={patch === "invalid"} canSave={!!patch && patch !== "invalid"}
      onSave={() => { if (patch && patch !== "invalid") void run(() => api.updateEvent(item.id, patch)); }}
      removeLabel="Удалить" onClose={onClose}
      onRemove={async () => { if (await confirmDialog("Удалить встречу?")) void run(() => api.deleteEvent(item.id)); }}>
      <label className="field"><span>Название</span>
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={busy} /></label>
      <label className="field"><span>Дата</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} /></label>
      <label className="field"><span>Время</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} /></label>
      <label className="field"><span>С кем</span>
        <input value={withWhom} maxLength={200} onChange={(e) => setWithWhom(e.target.value)} disabled={busy} /></label>
    </Frame>
  );
}

const KINDS: { key: NoteKind; label: string }[] = [{ key: "thought", label: "Мысль" }, { key: "journal", label: "Дневник" }];

export function NoteSheet({ api, item, onClose, onSaved }: Base<{ id: string; text: string; kind: NoteKind }>) {
  const [text, setText] = useState(item.text);
  const [kind, setKind] = useState<NoteKind>(item.kind);
  const { busy, error, run } = useRun(onSaved);
  const patch = buildNotePatch(item, { text, kind });
  return (
    <Frame title="Заметка" busy={busy} error={error} invalid={patch === "invalid"} canSave={!!patch && patch !== "invalid"}
      onSave={() => { if (patch && patch !== "invalid") void run(() => api.updateNote(item.id, patch)); }}
      removeLabel="Удалить" onClose={onClose}
      onRemove={async () => { if (await confirmDialog("Удалить заметку?")) void run(() => api.deleteNote(item.id)); }}>
      <label className="field"><span>Текст</span>
        <textarea rows={5} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} disabled={busy} /></label>
      <div className="chips">
        {KINDS.map((k) => (
          <button type="button" key={k.key} className={k.key === kind ? "pill done" : "pill"} aria-pressed={k.key === kind}
            onClick={() => setKind(k.key)} disabled={busy}>{k.label}</button>
        ))}
      </div>
    </Frame>
  );
}

export function HabitSheet({ api, item, onClose, onSaved }: Base<{ id: string; name: string; target_per_week: number }>) {
  const [name, setName] = useState(item.name);
  const [target, setTarget] = useState(item.target_per_week);
  const { busy, error, run } = useRun(onSaved);
  const patch = buildHabitPatch(item, { name, target });
  return (
    <Frame title="Привычка" busy={busy} error={error} invalid={patch === "invalid"} canSave={!!patch && patch !== "invalid"}
      onSave={() => { if (patch && patch !== "invalid") void run(() => api.updateHabit(item.id, patch)); }}
      removeLabel="Удалить" onClose={onClose}
      onRemove={async () => {
        if (await confirmDialog("Удалить привычку? История отметок сохранится.")) void run(() => api.archiveHabit(item.id));
      }}>
      <label className="field"><span>Название</span>
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} disabled={busy} /></label>
      <div className="field"><span>Раз в неделю</span>
        <div className="chips">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <button type="button" key={n} className={n === target ? "pill done" : "pill"} aria-pressed={n === target}
              onClick={() => setTarget(n)} disabled={busy}>{n === 7 ? "каждый день" : n}</button>
          ))}
        </div>
      </div>
    </Frame>
  );
}
