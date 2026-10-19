import { L } from '../../constants/labels';
import { Button } from '../primitives/Button';

const H = L.common.help;

/** Contextual help (module-level), the guided tour (COM-12) and the prototype boundary disclosure. */
export function HelpContent({ mod, onStartTour }: { mod: string; onStartTour?: () => void }) {
  const h = H.modules[mod] ?? H.modules.home;
  return (
    <div className="help">
      <section>
        <h3>{h.title}</h3>
        <ul className="plain-list bullets">
          {h.body.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>
      {onStartTour && (
        <section>
          <h3>{H.tourTitle}</h3>
          <p className="muted">{H.tourBody}</p>
          <Button icon="play" onClick={onStartTour}>
            {H.tourStart}
          </Button>
        </section>
      )}
      <section>
        <h3>{H.realTitle}</h3>
        <ul className="plain-list bullets">
          {H.real.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>{H.keyboardTitle}</h3>
        <ul className="plain-list bullets">
          <li>
            <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> — {H.kbSearch}
          </li>
          <li>
            <kbd>↑</kbd>/<kbd>↓</kbd> {H.kbGrid}
          </li>
          <li>
            <kbd>Esc</kbd> {H.kbEsc}
          </li>
          <li>
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> {H.kbComment}
          </li>
        </ul>
      </section>
    </div>
  );
}
