import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../primitives/Button';
import { L } from '../../constants/labels';

type Recognition = { start: () => void; stop: () => void; lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void };
const Ctor = (typeof window !== 'undefined' && ((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition)) as (new () => Recognition) | undefined;

/** NFR-21 voice-to-text: appends dictated text (en-IN) via the browser's speech API; disabled with a reason when unavailable. */
export function VoiceButton({ onText, label = L.common.voice.dictate }: { onText: (text: string) => void; label?: string }) {
  const [on, setOn] = useState(false);
  const rec = useRef<Recognition | null>(null);
  useEffect(() => () => rec.current?.stop(), []);
  if (!Ctor) return <IconButton icon="message" label={label} disabledReason={L.common.voice.unsupported} />;
  return (
    <IconButton
      icon={on ? 'x' : 'message'}
      label={on ? L.common.voice.stop : label}
      aria-pressed={on}
      onClick={() => {
        if (on) return rec.current?.stop();
        const r = new Ctor();
        r.lang = 'en-IN';
        r.interimResults = false;
        r.onresult = (e) => onText(Array.from(e.results).map((x) => x[0].transcript).join(' '));
        r.onend = () => setOn(false);
        r.onerror = () => setOn(false);
        rec.current = r;
        setOn(true);
        r.start();
      }}
    />
  );
}
