import type { AnchorHTMLAttributes } from 'react';

type ButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: 'primary' | 'secondary' };

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return <a className={`btn btn--${variant} ${className}`.trim()} {...props} />;
}
