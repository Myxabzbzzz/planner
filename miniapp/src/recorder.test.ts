import { describe, expect, it } from "vitest";
import { baseMime, fmtSeconds, micSupported, pickMime } from "./recorder";

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
