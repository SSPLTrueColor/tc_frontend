import { useEffect, useRef, useState } from 'react';
import { demoUsers } from '../../domain/clinic/pack';
import { uid } from '../../lib/ids';
import type { Actor } from '../../services/authz';
import { addComment, getCommentDraft, saveCommentDraft } from '../../services/collab';
import { ServiceError } from '../../services/types';
import { Button, IconButton } from '../primitives/Button';
import { useToast } from '../primitives/feedback';
import { Popover } from '../primitives/overlay';

/**
 * The ONE persistent Quick Comment composer, rendered once at the bottom of the
 * inspector, outside the tab panels — so switching tabs never remounts it and
 * the Comments tab never shows a second composer. Drafts autosave per record
 * (render with key={recordId}; the outgoing record's draft is flushed on unmount).
 */
export function QuickComment({ actor, resource, recordId }: { actor: Actor; resource: string; recordId: string }) {
  const [text, setText] = useState(() => getCommentDraft(actor, resource, recordId));
  const [expanded, setExpanded] = useState(() => !!getCommentDraft(actor, resource, recordId));
  const [sending, setSending] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const mentionRef = useRef<HTMLButtonElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const keyRef = useRef(uid('cmt'));
  const toast = useToast();
  // Refs keep the latest values for the unmount flush without re-running effects.
  const latest = useRef({ actor, resource, recordId, text });
  latest.current = { actor, resource, recordId, text };

  const flush = () => {
    const l = latest.current;
    if (getCommentDraft(l.actor, l.resource, l.recordId) !== l.text) saveCommentDraft(l.actor, l.resource, l.recordId, l.text);
  };

  // Debounced local autosave of the draft.
  useEffect(() => {
    const t = setTimeout(flush, 600);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush on unmount (e.g. switching to another record or closing the inspector).
  useEffect(() => flush, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = () => {
    if (sending || !text.trim()) return;
    setSending(true);
    try {
      addComment(actor, resource, recordId, text, keyRef.current);
      keyRef.current = uid('cmt');
      latest.current.text = '';
      setText('');
      setExpanded(false);
      toast('Internal comment added');
    } catch (e) {
      toast(e instanceof ServiceError ? e.message : 'Could not add comment', 'danger');
    } finally {
      setSending(false);
    }
  };

  const insertMention = (name: string) => {
    setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${name} `);
    setMentionOpen(false);
    setExpanded(true);
    setTimeout(() => areaRef.current?.focus(), 0);
  };

  return (
    <div className="quick-comment" data-testid="quick-comment">
      <label htmlFor={`qc-${recordId}`} className="sr-only">
        Quick comment on {recordId}
      </label>
      <textarea
        ref={areaRef}
        id={`qc-${recordId}`}
        className={expanded ? 'qc-input is-expanded' : 'qc-input'}
        rows={expanded ? 3 : 1}
        placeholder="Add an internal comment… (@ to mention, Ctrl+Enter to send)"
        value={text}
        maxLength={2000}
        onFocus={() => setExpanded(true)}
        onBlur={() => !text && setExpanded(false)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
          if (e.key === '@') {
            setTimeout(() => setMentionOpen(true), 0);
          }
        }}
      />
      {expanded && (
        <div className="qc-bar">
          <span className="qc-visibility" data-tooltip="Internal comments are visible to clinic staff with access to this record">
            Internal note
          </span>
          <IconButton ref={mentionRef} icon="users" label="Mention a teammate" onClick={() => setMentionOpen((o) => !o)} aria-haspopup="dialog" />
          <IconButton icon="send" label="Send to patient (external)" disabledReason="External messaging is not connected in this prototype" />
          <span className="qc-spacer" />
          {text && (
            <Button
              variant="ghost"
              onClick={() => {
                setText('');
                setExpanded(false);
              }}
            >
              Clear
            </Button>
          )}
          <Button variant="primary" loading={sending} disabled={!text.trim()} onClick={send}>
            Comment
          </Button>
        </div>
      )}
      <Popover open={mentionOpen} onClose={() => setMentionOpen(false)} anchor={mentionRef.current ? mentionRef : areaRef} label="Mention a teammate" width={240}>
        <ul className="menu" role="listbox" aria-label="Teammates">
          {demoUsers
            .filter((u) => u.id !== actor.user.id)
            .map((u) => (
              <li key={u.id}>
                <button type="button" className="menu-item" onClick={() => insertMention(u.name)}>
                  {u.name}
                </button>
              </li>
            ))}
        </ul>
      </Popover>
    </div>
  );
}
