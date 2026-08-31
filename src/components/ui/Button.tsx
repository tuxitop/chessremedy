import type * as React from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'className'
> {
  variant?: ButtonVariant;
  className?: string;
}

export function Button({
  variant = 'primary',
  className,
  type,
  ...rest
}: ButtonProps): React.JSX.Element {
  const cls = [styles.button, styles[variant], className].filter(Boolean).join(' ');
  return <button type={type ?? 'button'} className={cls} {...rest} />;
}
