/**
 * Numeric input (COM-05). The user's text is kept exactly as typed and parsed strictly
 * (services/validation.ts `parseNumberText`): a minus sign, "1e6", "+" or letters show an inline
 * error instead of being stripped, and out-of-range values are flagged, never clamped.
 *
 *   <NumberInput value={qty} onValueChange={(n) => …} rule={NUMBER_LIMITS.qty} />
 *
 * `onValueChange` receives the parsed number (also when it is out of range, so the caller's own
 * validation can block the save), `NaN` when the text is not a plain number, or `null` when empty.
 * Use `useNumberText` when the error has to be shown somewhere else (affix wrappers, table cells).
 */
import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { cx } from '../../lib/format';
import { parseNumberText, type NumberRule } from '../../services/validation';
import { TextField, type TextFieldProps } from './controls';

export function useNumberText(value: number | null | undefined, rule: NumberRule, onValueChange: (n: number | null, raw: string) => void) {
  const shown = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '' : String(v));
  const [text, setText] = useState(() => shown(value));
  const last = useRef<number | null | undefined>(value);
  // Follow outside changes (reset, recalculated amount) without overwriting what the user is typing.
  useEffect(() => {
    if (value === last.current || (Number.isNaN(value) && Number.isNaN(last.current))) return;
    last.current = value;
    if (Number.isNaN(value)) return;
    const typed = parseNumberText(text, rule).value;
    if (typed !== value) setText(shown(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const { error } = parseNumberText(text, rule);
  const onChange = (raw: string) => {
    setText(raw);
    const parsed = parseNumberText(raw, rule).value;
    last.current = parsed;
    onValueChange(parsed, raw);
  };
  return { text, error, onChange };
}

export interface NumberInputProps extends Omit<TextFieldProps, 'value' | 'onChange' | 'type' | 'min' | 'max'> {
  value: number | null | undefined;
  onValueChange: (n: number | null, raw: string) => void;
  rule?: NumberRule;
  /** Render the parse / range message under the input (default). Off when the caller shows its own error. */
  showError?: boolean;
  /** Affix inside the field, e.g. "₹" before or "%" / "mm" after (template `input-affix`). */
  prefix?: string;
  suffix?: string;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput({ value, onValueChange, rule = {}, showError = true, invalid, id, prefix, suffix, ...rest }, ref) {
  const auto = useId();
  const { text, error, onChange } = useNumberText(value, rule, onValueChange);
  const errId = `${id ?? auto}-num-err`;
  const visible = showError && !!error && !invalid;
  const input = (
      <TextField
        ref={ref}
        id={id}
        inputMode={rule.integer ? 'numeric' : 'decimal'}
        autoComplete="off"
        {...rest}
        value={text}
        invalid={invalid || !!error}
        aria-describedby={[rest['aria-describedby'], visible ? errId : ''].filter(Boolean).join(' ') || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
  );
  return (
    <>
      {prefix || suffix ? (
        <div className={cx('input-affix', prefix && 'has-start', suffix && 'has-end')}>
          {prefix && <span className="affix affix-start">{prefix}</span>}
          {input}
          {suffix && <span className="affix affix-end">{suffix}</span>}
        </div>
      ) : (
        input
      )}
      {visible && (
        <p className="field-error" id={errId} role="alert">
          {error}
        </p>
      )}
    </>
  );
});
