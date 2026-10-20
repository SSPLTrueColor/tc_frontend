/** Small shared pieces for Administration pages: client-side pagination footer (same markup as list grids). */
import { useState } from 'react';
import { L } from '../../constants/labels';
import { IconButton } from '../../components/primitives/Button';
import { SelectMenu } from '../../components/primitives/SelectMenu';

export { usePaged } from '../../components/primitives/Pagination';

export type SortDir = 'desc' | 'asc';

/** "Newest first / Oldest first" picker used by the log-style lists. */
export function SortPicker({ value, onChange }: { value: SortDir; onChange: (v: SortDir) => void }) {
  const C = L.admin.common;
  return (
    <SelectMenu<SortDir>
      label={C.sortOrder}
      value={value}
      options={[
        { value: 'desc', label: C.newestFirst },
        { value: 'asc', label: C.oldestFirst },
      ]}
      onChange={onChange}
    />
  );
}

/** Sort by an ISO timestamp field. */
export const byTime = <T,>(rows: T[], at: (r: T) => string, dir: SortDir) => [...rows].sort((a, b) => (dir === 'desc' ? at(b).localeCompare(at(a)) : at(a).localeCompare(at(b))));

const guideKey = (id: string) => `tc.guide.hidden.${id}`;
const guideHidden = (id: string) => {
  try {
    return localStorage.getItem(guideKey(id)) === '1';
  } catch {
    return false;
  }
};

/** Dismissible "how this works" strip for Settings pages: numbered steps, remembered per page in this browser. */
export function QuickGuide({ id, steps }: { id: string; steps: readonly { title: string; body: string }[] }) {
  const G = L.admin.guide;
  const [hidden, setHidden] = useState(() => guideHidden(id));
  const set = (v: boolean) => {
    setHidden(v);
    try {
      if (v) localStorage.setItem(guideKey(id), '1');
      else localStorage.removeItem(guideKey(id));
    } catch {
      /* storage unavailable: the guide simply reappears next visit */
    }
  };
  if (hidden)
    return (
      <p className="guide-link">
        <button type="button" className="rel-link" onClick={() => set(false)}>
          {G.show}
        </button>
      </p>
    );
  return (
    <section className="guide" aria-label={G.title}>
      <ol className="guide-steps">
        {steps.map((s, i) => (
          <li key={s.title}>
            <span className="guide-num" aria-hidden="true">
              {i + 1}
            </span>
            <span>
              <strong>{s.title}</strong>
              <span className="muted small guide-body">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <IconButton icon="x" label={G.hide} onClick={() => set(true)} />
    </section>
  );
}
