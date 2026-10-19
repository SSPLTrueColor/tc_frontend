import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../../lib/format';
import { Icon } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'default' | 'compact';
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  /** Explains why the action is unavailable (rendered as tooltip + sr text). */
  disabledReason?: string;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'compact', icon, iconRight, loading, disabled, disabledReason, className, children, type = 'button', title, ...rest },
  ref,
) {
  const isDisabled = disabled || loading || !!disabledReason;
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', `btn-${variant}`, size === 'default' && 'btn-default', className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-tooltip={disabledReason ?? title}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children && <span className="btn-label">{children}</span>}
      {iconRight && <Icon name={iconRight} />}
      {disabledReason && <span className="sr-only">. Unavailable: {disabledReason}</span>}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  label: string;
  pressed?: boolean;
  badge?: number;
  disabledReason?: string;
  variant?: 'ghost' | 'secondary';
}

/** Icon-only control: always has an accessible name and a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, pressed, badge, disabled, disabledReason, className, variant = 'ghost', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('icon-btn', `icon-btn-${variant}`, pressed && 'is-pressed', className)}
      aria-label={disabledReason ? `${label} (unavailable: ${disabledReason})` : label}
      aria-pressed={pressed}
      data-tooltip={disabledReason ? `${label} — ${disabledReason}` : label}
      disabled={disabled || !!disabledReason}
      {...rest}
    >
      <Icon name={icon} />
      {!!badge && (
        <span className="icon-btn-badge" aria-hidden="true">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
});
