import type { Note, NotesResp } from "./types";

export type NotesState = { notes: Note[]; next: string | null; loading: boolean; error: boolean };

export function makeNotesLoader(
  fetchPage: (q: string, before?: string) => Promise<NotesResp>,
  onState: (s: NotesState) => void,
) {
  let counter = 0;
  let query = "";
  let state: NotesState = { notes: [], next: null, loading: false, error: false };
  const set = (s: Partial<NotesState>) => { state = { ...state, ...s }; onState(state); };

  const run = (before?: string) => {
    const id = counter;
    set({ loading: true, error: false });
    fetchPage(query, before).then(
      (r) => {
        if (id !== counter) return;
        set({ notes: before ? [...state.notes, ...r.notes] : r.notes, next: r.next_before, loading: false });
      },
      () => {
        if (id !== counter) return;
        set({ loading: false, error: true });
      },
    );
  };

  return {
    search(q: string) {
      counter++;
      query = q;
      state = { notes: [], next: null, loading: false, error: false };
      run();
    },
    more() {
      if (state.loading || state.next === null) return;
      run(state.next);
    },
  };
}
