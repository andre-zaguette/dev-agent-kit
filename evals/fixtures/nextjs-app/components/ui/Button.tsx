import Link from 'next/link';
import type { ReactNode } from 'react';

export function Button({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="btn btn--primary">
      {children}
    </Link>
  );
}
