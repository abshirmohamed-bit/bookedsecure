import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice for the Assistant, using the browser's own speech features (no audio
 * leaves the device through BookedSecure): speech-to-text with the Web Speech
 * API and spoken replies with speechSynthesis. Both are optional and the
 * controls hide themselves where the browser has no support.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

function recognitionConstructor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Turns an assistant reply into something pleasant to hear (no markdown, links or ids). */
export function speakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/[*_#>`|]/g, " ")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

const SPEAK_KEY = "bookedsecure:assistant-speak-replies";

export function useVoice({ onTranscript, onFinal }: { onTranscript: (text: string) => void; onFinal: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [speakReplies, setSpeakRepliesState] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const callbacks = useRef({ onTranscript, onFinal });
  callbacks.current = { onTranscript, onFinal };

  useEffect(() => {
    setCanListen(Boolean(recognitionConstructor()));
    setCanSpeak(typeof window !== "undefined" && "speechSynthesis" in window);
    try {
      setSpeakRepliesState(window.localStorage.getItem(SPEAK_KEY) === "true");
    } catch {
      /* storage unavailable */
    }
    return () => {
      recognition.current?.abort();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const setSpeakReplies = useCallback((on: boolean) => {
    setSpeakRepliesState(on);
    if (!on && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    try {
      window.localStorage.setItem(SPEAK_KEY, String(on));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const stopListening = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const startListening = useCallback(() => {
    const Ctor = recognitionConstructor();
    if (!Ctor || listening) return;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    const r = new Ctor();
    r.lang = "en-AU";
    r.continuous = false;
    r.interimResults = true;
    finalText.current = "";
    r.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        const piece = result[0]?.transcript ?? "";
        if (result.isFinal) finalText.current += piece;
        else interim += piece;
      }
      callbacks.current.onTranscript(`${finalText.current}${interim}`.trim());
    };
    r.onerror = () => setListening(false);
    r.onend = () => {
      setListening(false);
      const text = finalText.current.trim();
      if (text) callbacks.current.onFinal(text);
    };
    recognition.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening]);

  /** Reads text aloud; resolves when finished (or straight away when unsupported). */
  const speak = useCallback((text: string) => new Promise<void>((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve();
    const spoken = speakableText(text);
    if (!spoken) return resolve();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = "en-AU";
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang === "en-AU") ?? window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("en"));
    if (voice) utterance.voice = voice;
    utterance.onend = () => { setSpeaking(false); resolve(); };
    utterance.onerror = () => { setSpeaking(false); resolve(); };
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }), []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { canListen, canSpeak, listening, speaking, speakReplies, setSpeakReplies, startListening, stopListening, speak, stopSpeaking };
}
