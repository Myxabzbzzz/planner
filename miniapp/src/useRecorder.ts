import { useEffect, useRef, useState } from "react";
import { makeRecorder, MAX_SECONDS } from "./recorder";

export function useRecorder(onClip: (blob: Blob) => void) {
  const [state, setState] = useState<"idle" | "recording">("idle");
  const [seconds, setSeconds] = useState(0);
  const [denied, setDenied] = useState(false);
  const clip = useRef(onClip);
  clip.current = onClip;
  const rec = useRef<ReturnType<typeof makeRecorder> | null>(null);
  if (!rec.current) {
    rec.current = makeRecorder({
      isTypeSupported: (m) => MediaRecorder.isTypeSupported(m),
      getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
      createRecorder: (stream, mime) => new MediaRecorder(stream, { mimeType: mime }),
    }, { onState: setState, onClip: (b) => clip.current(b), onDenied: () => setDenied(true) });
  }

  useEffect(() => {
    if (state !== "recording") return;
    setSeconds(0);
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => {
    if (state === "recording" && seconds >= MAX_SECONDS) rec.current?.stop(true);
  }, [state, seconds]);

  useEffect(() => () => rec.current?.stop(false), []);

  return { state, seconds, denied, start: () => rec.current!.start(), stop: (send: boolean) => rec.current!.stop(send) };
}
