import { Icon } from './Icon';

/**
 * Info icon (ⓘ) — the ONE place explanatory sentences live (owner rule: descriptions/help text are
 * never printed as visible text). It uses the global TooltipLayer (portal), so the tooltip is never
 * clipped by panels, dialogs or tables. Opens on hover, keyboard focus and tap; Esc closes.
 */
export function InfoTip({ text, label = 'More information' }: { text: string; label?: string }) {
  if (!text) return null;
  return (
    <button type="button" className="infotip-btn" aria-label={`${label}: ${text}`} data-tooltip={text} data-tooltip-toggle="">
      <Icon name="info" size={16} />
    </button>
  );
}
