import { describe, expect, it } from "vitest";
import { baseMime, fmtSeconds, makeRecorder, micSupported, pickMime } from "./recorder";

describe("pickMime", () => {
  it("prefers mp4, then webm/opus, then webm", () => {
    expect(pickMime(() => true)).toBe("audio/mp4");
    expect(pickMime((m) => m.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickMime((m) => m === "audio/webm")).toBe("audio/webm");
    expect(pickMime(() => false)).toBeNull();
  });
});

describe("micSupported", () => {
  const MR = { isTypeSupported: (m: string) => m === "audio/mp4" };
  it("needs getUserMedia and a supported MediaRecorder type", () => {
    expect(micSupported({ mediaDevices: { getUserMedia: () => 0 }, MediaRecorder: MR })).toBe(true);
    expect(micSupported({ mediaDevices: {}, MediaRecorder: MR })).toBe(false);
    expect(micSupported({ mediaDevices: { getUserMedia: () => 0 } })).toBe(false);
    expect(micSupported({ mediaDevices: { getUserMedia: () => 0 }, MediaRecorder: { isTypeSupported: () => false } })).toBe(false);
  });
});

describe("helpers", () => {
  it("strips mime params and formats seconds", () => {
    expect(baseMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(fmtSeconds(5)).toBe("0:05");
    expect(fmtSeconds(60)).toBe("1:00");
  });
});

describe("makeRecorder", () => {
  type Ev = { data: Blob };
  function fakes() {
    const stopped: string[] = [];
    let resolveMedia: ((s: MediaStream) => void) | null = null;
    const stream = { getTracks: () => [{ stop: () => stopped.push("track") }] } as unknown as MediaStream;
    const recs: Array<{ state: string; mimeType: string; ondataavailable: ((e: Ev) => void) | null; onstop: (() => void) | null;
      start(): void; stop(): void }> = [];
    const deps = {
      isTypeSupported: (m: string) => m === "audio/mp4",
      getUserMedia: () => new Promise<MediaStream>((r) => { resolveMedia = r; }),
      createRecorder: () => {
        const r = { state: "inactive", mimeType: "audio/mp4", ondataavailable: null as ((e: Ev) => void) | null,
          onstop: null as (() => void) | null,
          start() { this.state = "recording"; },
          stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(4)]) }); this.onstop?.(); } };
        recs.push(r);
        return r as unknown as MediaRecorder;
      },
    };
    const events = { states: [] as string[], clips: [] as Blob[], denied: 0 };
    const ev = { onState: (s: string) => events.states.push(s), onClip: (b: Blob) => events.clips.push(b), onDenied: () => { events.denied += 1; } };
    return { deps, ev, events, stopped, recs, grant: () => resolveMedia!(stream) };
  }

  it("ignores a second tap while waiting for the microphone", async () => {
    const f = fakes();
    let asked = 0;
    const deps = { ...f.deps, getUserMedia: () => { asked += 1; return f.deps.getUserMedia(); } };
    const r = makeRecorder(deps, f.ev);
    const first = r.start();
    void r.start();
    f.grant();
    await first;
    expect(asked).toBe(1);
    expect(f.recs.length).toBe(1);
  });

  it("stops the tracks and sends the clip on stop(true)", async () => {
    const f = fakes();
    const r = makeRecorder(f.deps, f.ev);
    const p = r.start();
    f.grant();
    await p;
    r.stop(true);
    expect(f.stopped).toEqual(["track"]);
    expect(f.events.clips.length).toBe(1);
    expect(f.events.clips[0].type).toBe("audio/mp4");
    expect(f.events.states).toEqual(["recording", "idle"]);
  });

  it("stops the tracks without a clip on cancel", async () => {
    const f = fakes();
    const r = makeRecorder(f.deps, f.ev);
    const p = r.start();
    f.grant();
    await p;
    r.stop(false);
    expect(f.stopped).toEqual(["track"]);
    expect(f.events.clips).toEqual([]);
  });

  it("releases the microphone when the recorder cannot be created", async () => {
    const f = fakes();
    const r = makeRecorder({ ...f.deps, createRecorder: () => { throw new Error("NotSupportedError"); } }, f.ev);
    const p = r.start();
    f.grant();
    await p;
    expect(f.stopped).toEqual(["track"]);
    expect(f.events.denied).toBe(1);
    const again = r.start();  // можно попробовать снова
    f.grant();
    await again;
    expect(f.events.denied).toBe(2);
  });

  it("reports denial when access is refused", async () => {
    const f = fakes();
    const r = makeRecorder({ ...f.deps, getUserMedia: () => Promise.reject(new Error("NotAllowedError")) }, f.ev);
    await r.start();
    expect(f.events.denied).toBe(1);
  });
});
