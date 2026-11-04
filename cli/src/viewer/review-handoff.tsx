import { useEffect, useRef, useState } from 'react';
import { Check, CircleCheck, Copy } from 'lucide-react';

// Clipboard access can be absent, rejected, or throw before returning a promise.
export async function copy(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}

export function ReviewHandoff({ prompt, flush }: { prompt: string; flush: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ready) dialog.current?.showModal();
  }, [ready]);
  const send = async () => {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      await flush();
      setCopied(await copy(prompt));
      setReady(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      sending.current = false;
      setPending(false);
    }
  };
  return <>
    {error && <span className="error" role="alert">{error}</span>}
    <button data-review-handoff ref={trigger} type="button" className="btn primary" disabled={pending} onClick={() => void send()}>
      {pending ? 'Saving feedback...' : 'Send to agent'}
    </button>
    <dialog data-review-handoff ref={dialog} className="modal" aria-labelledby="handoff-title" onClose={() => { setReady(false); trigger.current?.focus({ preventScroll: true }); }}>
      <div className="done">
        <CircleCheck size={32} className="done-icon" />
        <h2 id="handoff-title">Feedback ready</h2>
        <p className="muted" role="status">{copied ? 'Prompt copied. Paste it into your agent’s chat.' : 'Copy this prompt into your agent’s chat.'}</p>
        <p className="hint">Only posted comments are included. Unposted text stays in this review.</p>
        <pre className="prompt" tabIndex={0}>{prompt}</pre>
        <button type="button" className="btn" onClick={() => void copy(prompt).then(setCopied)}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
        <button type="button" className="btn" onClick={() => dialog.current?.close()}>Back to review</button>
      </div>
    </dialog>
  </>;
}
