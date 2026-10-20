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
import { L } from '../../constants/labels';
import { TextField } from '../primitives/controls';
import { SegmentedControl } from '../primitives/controls';
import { ColorInput } from '../primitives/controls';

const TH = L.common.theme;

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
          {large ? TH.button : ''}
        </span>
      </span>
    </span>
  );
}

/**
 * Theme changer (shared): light / dark / system mode + colour palettes. Presets are fixed; users can
 * create, edit and delete their own palettes (saved per user). Used in the top bar popover and Settings.
 */
export function ThemePicker({ onEditPalette }: { onEditPalette?: (p: Palette) => void } = {}) {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const s = getSettings(actor.user.id);
  const current = findPalette(s.palette, s.customPalettes);
  const [localEditing, setLocalEditing] = useState<Palette | null>(null);
  // Inside a popover the editor must be opened by the owner (a dialog click would close the popover first).
  const setEditing = (p: Palette) => (onEditPalette ? onEditPalette(p) : setLocalEditing(p));

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
          <IconButton icon="pencil" label={TH.edit(p.name)} onClick={() => setEditing(p)} />
          <IconButton
            icon="trash"
            label={TH.delete(p.name)}
            onClick={() =>
              confirmDelete({
                title: TH.deleteTitle(p.name),
                message: TH.deleteBody(findPalette('violet', []).name),
                confirmLabel: TH.deleteAction,
                onConfirm: () => {
                  deleteCustomPalette(actor, p.id);
                  toast(TH.deleted(p.name));
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
        <span className="field-label">{TH.mode}</span>
        <SegmentedControl
          label={TH.colourMode}
          value={s.theme}
          onChange={(next) => updateSettings(actor.user.id, { theme: next })}
          options={(['system', 'light', 'dark'] as const).map((t) => ({ value: t, label: TH.modes[t] }))}
        />
      </div>
      <div className="form-field">
        <span className="field-label-row">
          <span className="field-label">{TH.palette}</span>
          <InfoTip text={TH.paletteAbout} label={TH.paletteAboutLabel} />
        </span>
        <ul className="pal-grid" role="radiogroup" aria-label={TH.palette}>
          {PRESET_PALETTES.map(card)}
          {s.customPalettes.map((p) => card({ ...p, custom: true }))}
          <li className="pal-item">
            <button type="button" className="pal-card pal-new" onClick={() => setEditing({ id: '', name: '', accent: current.accent, sidebar: current.sidebar, rail: current.rail, custom: true })}>
              <span className="pal-new-icon">
                <Icon name="plus" size={16} />
              </span>
              <span className="pal-name">{TH.create}</span>
            </button>
          </li>
        </ul>
      </div>
      {localEditing && <PaletteEditor initial={localEditing} onClose={() => setLocalEditing(null)} />}
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
        <ColorInput
          
          className="color-swatch"
          aria-label={TH.pickerAria(label)}
          value={value}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value);
          }}
        />
        <TextField
          id={id}
          
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
      {!valid && <span className="field-error">{TH.hexError}</span>}
    </div>
  );
}

/** Create / edit a custom palette with a live preview. */
export function PaletteEditor({ initial, onClose }: { initial: Palette; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [p, setP] = useState<Palette>(initial);
  const d = derivePalette(p);
  const isNew = !initial.id;
  const nameError = !p.name.trim() ? TH.nameError : undefined;
  const [tried, setTried] = useState(false);
  const save = () => {
    setTried(true);
    if (nameError) return;
    saveCustomPalette(actor, { id: initial.id || undefined, name: p.name, accent: p.accent, sidebar: p.sidebar, rail: p.rail });
    toast(isNew ? TH.createdApplied(p.name.trim()) : TH.updated(p.name.trim()));
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? TH.create : TH.edit(initial.name)}
      description={TH.editorDescription}
      footer={
        <>
          <Button onClick={onClose}>{L.common.actions.cancel}</Button>
          <Button variant="primary" onClick={save}>
            {isNew ? TH.save : L.common.actions.saveChanges}
          </Button>
        </>
      }
    >
      <div className="pal-editor">
        <div className="form-grid">
          <div className={cx('form-field span-2', tried && nameError && 'has-error')}>
            <label className="field-label" htmlFor="pal-name">
              {TH.name} <span className="req">*</span>
            </label>
            <TextField id="pal-name" value={p.name} maxLength={30} placeholder={TH.namePlaceholder} onChange={(e) => setP({ ...p, name: e.target.value })} data-autofocus aria-invalid={(tried && !!nameError) || undefined} />
            {tried && nameError && <span className="field-error">{nameError}</span>}
          </div>
          <ColorField id="pal-accent" label={TH.accent} value={p.accent} onChange={(v) => setP({ ...p, accent: v })} />
          <ColorField id="pal-sidebar" label={TH.sidebar} value={p.sidebar} onChange={(v) => setP({ ...p, sidebar: v })} />
          <ColorField id="pal-rail" label={TH.rail} value={p.rail} onChange={(v) => setP({ ...p, rail: v })} />
        </div>
        <div className="pal-preview">
          <span className="field-label">{TH.preview}</span>
          <PaletteMock p={p} large />
          <p className="pal-check">
            <Icon name={d.buttonContrast >= 4.5 ? 'check' : 'alert'} size={14} />
            {TH.contrast(d.onAccent === '#ffffff', d.buttonContrast.toFixed(1))}
          </p>
        </div>
      </div>
    </Dialog>
  );
}
