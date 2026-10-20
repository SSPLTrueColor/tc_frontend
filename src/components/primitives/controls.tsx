/**
 * Form controls — the only way pages render inputs. Thin wrappers over the template classes so that size,
 * focus ring, error styling and the 44 px touch rule are fixed in one place (see docs/COMPONENTS.md).
 *
 *   TextField / SearchInput / Textarea / Checkbox / Switch / SegmentedControl / LinkButton
 */
import { forwardRef, type AnchorHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, useId } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cx } from '../../lib/format';
import { Icon } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 32 px control for toolbars and table cells (default is 40 px, used in forms). */
  dense?: boolean;
  invalid?: boolean;
  /** Skip the template `input` look (inline title fields that style themselves). */
  bare?: boolean;
}

/** Single-line input (text, number, time, email …). Not for checkboxes or radios. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ dense, invalid, bare, className, ...rest }, ref) {
  return <input ref={ref} className={cx(!bare && 'input', !bare && dense && 'input-compact', className)} aria-invalid={invalid || rest['aria-invalid'] || undefined} {...rest} />;
});

/** Search box for list toolbars: always dense, always `type="search"`. Give it an `aria-label`. */
export const SearchInput = forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type'>>(function SearchInput({ dense = true, ...rest }, ref) {
  return <TextField ref={ref} type="search" dense={dense} {...rest} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** Skip the template `input` look (self-styled fields such as the quick comment). */
  bare?: boolean;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, bare, className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(!bare && 'input', className)} aria-invalid={invalid || rest['aria-invalid'] || undefined} {...rest} />;
});

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(function Checkbox({ className, ...rest }, ref) {
  return <input ref={ref} type="checkbox" className={className} {...rest} />;
});

/** File chooser. `hidden` is for a button-triggered picker (use a ref); otherwise it shows as a normal field. */
export const FileInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { invalid?: boolean; visuallyHidden?: boolean }>(function FileInput({ className, invalid, hidden, visuallyHidden, ...rest }, ref) {
  return <input ref={ref} type="file" hidden={hidden} className={hidden ? className : visuallyHidden ? cx('sr-only', className) : cx('input', className)} aria-invalid={invalid || rest['aria-invalid'] || undefined} {...rest} />;
});

/** A button-looking file chooser ("Upload", "Replace"): a label around a visually hidden file input. */
export function FileButton({ children, variant = 'secondary', size = 'default', className, ...input }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & { variant?: Variant; size?: 'default' | 'compact'; children: ReactNode }) {
  return (
    <label className={cx('btn', `btn-${variant}`, size === 'default' && 'btn-default', className)}>
      <FileInput visuallyHidden {...input} />
      {children}
    </label>
  );
}

/** Colour picker swatch (theme editor). */
export const ColorInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(function ColorInput({ className, ...rest }, ref) {
  return <input ref={ref} type="color" className={cx('color-swatch', className)} {...rest} />;
});

export const Radio = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(function Radio({ className, ...rest }, ref) {
  return <input ref={ref} type="radio" className={className} {...rest} />;
});

/** On / off switch with its own accessible name; `text` is an optional visible caption ("Shown", "Active"). */
export function Switch({ checked, onChange, label, text, tooltip, disabled, id, className, describedBy }: { checked: boolean; onChange: (v: boolean) => void; label: string; text?: ReactNode; tooltip?: string; disabled?: boolean; id?: string; className?: string; describedBy?: string }) {
  const auto = useId();
  return (
    <label className={cx('switch', className)} data-tooltip={tooltip}>
      <input id={id ?? auto} type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label} aria-describedby={describedBy} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      {text && <span className="small">{text}</span>}
    </label>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: string;
  disabled?: boolean;
  /** Plain-text name when `label` is not a string. */
  ariaLabel?: string;
  /** Tooltip, e.g. a keyboard shortcut. */
  title?: string;
}

/** 2–5 mutually exclusive choices shown at once (view mode, period, method). More than 5: use SelectMenu. */
export function SegmentedControl<T extends string>({ options, value, onChange, label, className }: { options: SegmentOption<T>[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div className={cx('segmented', className)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} aria-label={o.ariaLabel} data-tooltip={o.title} disabled={o.disabled} className={cx('seg-btn', value === o.value && 'is-on')} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface LinkButtonProps extends Omit<LinkProps, 'className'> {
  variant?: Variant;
  size?: 'default' | 'compact';
  icon?: string;
  className?: string;
}

/** A link that looks like a Button (navigation, not an action): "Open order", "Back to ticket". */
export function LinkButton({ variant = 'secondary', size = 'compact', icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={cx('btn', `btn-${variant}`, size === 'default' && 'btn-default', className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children && <span className="btn-label">{children}</span>}
    </Link>
  );
}

export type { AnchorHTMLAttributes };
