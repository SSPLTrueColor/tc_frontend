import { useState } from 'react';
import { cx } from '../../lib/format';
import { derivePalette, findPalette, isHex, type Palette, PRESET_PALETTES } from '../../lib/palette';
import { useActor, useRevision } from '../../services/hooks';
import { deleteCustomPalette, getSettings, saveCustomPalette, updateSettings } from '../../services/settings';
import { Button, IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { InfoTip } from '../primitives/InfoTip';
import { confirmDelete, Dialog } from '../primitives/overlay';
import { useToast } from '../primitives/feedback';

/** Small mock of the app in a palette's colours: rail · sidebar · content with an accent button. */
function PaletteMock({ p, large }: { p: Palette; large?: boolean }) {
  const d = derivePalette(p);
  return (
    <span className={cx('pal-mock', large && 'is-large')} aria-hidden="true">
      <span className="pal-mock-rail" style={{ background: d.rail }}>
        <span style={{ background: d.railSelectedBg }} />
      </span>
      <span className="pal-mock-side" style={{ background: d.sidebar }}>
        <span style={{ background: `color-mix(in srgb, ${d.accent} 15%, #ffffff)` }} />
        <span />
        <span />
      </span>
      <span className="pal-mock-main">
        <span className="pal-mock-tab" style={{ borderColor: d.accent }} />
        <span className="pal-mock-line" />
        <span className="pal-mock-line short" />
        <span className="pal-mock-btn" style={{ background: d.accent, color: d.onAccent }}>
          {large ? 'Button' : ''}
        </span>
      </span>
    </span>
  );
}

/**
 * Theme changer (shared): light / dark / system mode + colour palettes. Presets are fixed; users can
 * create, edit and delete their own palettes (saved per user). Used in the top bar popover and Settings.
 */
export function ThemePicker() {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const s = getSettings(actor.user.id);
  const current = findPalette(s.palette, s.customPalettes);
  const [editing, setEditing] = useState<Palette | null>(null);

  const card = (p: Palette) => (
    <li key={p.id} className="pal-item">
      <button type="button" role="radio" aria-checked={current.id === p.id} className={cx('pal-card', current.id === p.id && 'is-on')} onClick={() => updateSettings(actor.user.id, { palette: p.id })}>
        <PaletteMock p={p} />
        <span className="pal-name">
          {p.name}
          {current.id === p.id && <Icon name="check" size={14} />}
        </span>
      </button>
      {p.custom && (
        <span className="pal-tools">
          <IconButton icon="pencil" label={`Edit ${p.name}`} onClick={() => setEditing(p)} />
          <IconButton
            icon="trash"
            label={`Delete ${p.name}`}
            onClick={() =>
              confirmDelete({
                title: `Delete palette "${p.name}"?`,
                message: 'The palette is removed from your themes. If it is in use, the app switches back to Soft violet.',
                confirmLabel: 'Delete palette',
                onConfirm: () => {
                  deleteCustomPalette(actor, p.id);
                  toast(`Palette "${p.name}" deleted`);
                },
              })
            }
          />
        </span>
      )}
    </li>
  );

  return (
    <div className="theme-picker">
      <div className="form-field">
        <span className="field-label">Mode</span>
        <div className="segmented" role="radiogroup" aria-label="Colour mode">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={s.theme === t} className={cx('seg-btn', s.theme === t && 'is-on')} onClick={() => updateSettings(actor.user.id, { theme: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="form-field">
        <span className="field-label-row">
          <span className="field-label">Colour palette</span>
          <InfoTip text="Ready-made colour combinations, or create your own. A palette sets the accent (buttons, links, selection), the sidebar and the icon rail. Text on the accent is kept readable automatically." label="About colour palettes" />
        </span>
        <ul className="pal-grid" role="radiogroup" aria-label="Colour palette">
          {PRESET_PALETTES.map(card)}
          {s.customPalettes.map((p) => card({ ...p, custom: true }))}
          <li className="pal-item">
            <button type="button" className="pal-card pal-new" onClick={() => setEditing({ id: '', name: '', accent: current.accent, sidebar: current.sidebar, rail: current.rail, custom: true })}>
              <span className="pal-new-icon">
                <Icon name="plus" size={16} />
              </span>
              <span className="pal-name">Create palette</span>
            </button>
          </li>
        </ul>
      </div>
      {editing && <PaletteEditor initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const valid = isHex(text);
  return (
    <div className="form-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <span className={cx('color-field', !valid && 'is-invalid')}>
        <input
          type="color"
          className="color-swatch"
          aria-label={`${label} picker`}
          value={value}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value);
          }}
        />
        <input
          id={id}
          className="input"
          value={text}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!valid || undefined}
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setText(v);
            if (isHex(v)) onChange(v.toLowerCase());
          }}
        />
      </span>
      {!valid && <span className="field-error">Use a 6-digit hex colour, e.g. #5b47c7</span>}
    </div>
  );
}

/** Create / edit a custom palette with a live preview. */
function PaletteEditor({ initial, onClose }: { initial: Palette; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [p, setP] = useState<Palette>(initial);
  const d = derivePalette(p);
  const isNew = !initial.id;
  const nameError = !p.name.trim() ? 'Give the palette a name' : undefined;
  const [tried, setTried] = useState(false);
  const save = () => {
    setTried(true);
    if (nameError) return;
    saveCustomPalette(actor, { id: initial.id || undefined, name: p.name, accent: p.accent, sidebar: p.sidebar, rail: p.rail });
    toast(isNew ? `Palette "${p.name.trim()}" created and applied` : `Palette "${p.name.trim()}" updated`);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Create palette' : `Edit ${initial.name}`}
      description="Pick an accent, a sidebar and an icon-rail colour. The preview updates as you change them; saving applies the palette."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {isNew ? 'Save palette' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="pal-editor">
        <div className="form-grid">
          <div className={cx('form-field span-2', tried && nameError && 'has-error')}>
            <label className="field-label" htmlFor="pal-name">
              Name <span className="req">*</span>
            </label>
            <input id="pal-name" className="input" value={p.name} maxLength={30} placeholder="e.g. Clinic teal" onChange={(e) => setP({ ...p, name: e.target.value })} data-autofocus aria-invalid={(tried && !!nameError) || undefined} />
            {tried && nameError && <span className="field-error">{nameError}</span>}
          </div>
          <ColorField id="pal-accent" label="Accent" value={p.accent} onChange={(v) => setP({ ...p, accent: v })} />
          <ColorField id="pal-sidebar" label="Sidebar" value={p.sidebar} onChange={(v) => setP({ ...p, sidebar: v })} />
          <ColorField id="pal-rail" label="Icon rail" value={p.rail} onChange={(v) => setP({ ...p, rail: v })} />
        </div>
        <div className="pal-preview">
          <span className="field-label">Preview</span>
          <PaletteMock p={p} large />
          <p className="pal-check">
            <Icon name={d.buttonContrast >= 4.5 ? 'check' : 'alert'} size={14} />
            Button text: {d.onAccent === '#ffffff' ? 'white' : 'dark'} · contrast {d.buttonContrast.toFixed(1)}:1
          </p>
        </div>
      </div>
    </Dialog>
  );
}
