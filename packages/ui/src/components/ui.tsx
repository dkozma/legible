// UI primitives in the shadcn/ui style: Tailwind utilities, variants with cva.
// Shapes and sizes follow the M0 design canvas.

import { cva, type VariantProps } from 'class-variance-authority';
import { type ClassValue, clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent font-medium leading-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary-hover',
        outline: 'border-input bg-field text-foreground hover:bg-field-hover',
        ghost: 'bg-transparent text-foreground hover:bg-hover',
        muted: 'bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground',
        link: 'h-auto bg-transparent p-0 text-foreground underline underline-offset-3',
        plain: 'h-auto bg-transparent p-0 text-muted-foreground hover:text-foreground',
      },
      size: {
        default: 'h-8 px-3 text-base [&_svg]:size-4',
        sm: 'h-7 gap-[5px] px-2.5 text-sm [&_svg]:size-3.5',
        xs: 'h-6 gap-1 rounded-sm px-2 text-sm [&_svg]:size-3.5',
        lg: 'h-10 px-[18px] text-[14px]',
        icon: 'size-8 p-0 [&_svg]:size-4',
        'icon-sm': 'size-7 p-0 [&_svg]:size-3.5',
        'icon-xs': 'size-6 rounded-sm p-0 [&_svg]:size-3.5',
        none: '',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

export const badgeVariants = cva(
  'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-transparent px-[7px] text-xs font-medium leading-none [&_svg]:size-3',
  {
    variants: {
      tone: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        muted: 'border-border text-muted-foreground',
        unrequested: 'border-unrequested-border bg-unrequested-bg text-unrequested',
        elevated: 'border-elevated-border bg-elevated-bg text-elevated',
        critical: 'border-critical-border bg-critical-bg text-critical',
        ask: 'border-ask-border bg-ask-bg text-ask',
        ok: 'border-ok-border bg-ok-bg text-ok',
      },
    },
    defaultVariants: { tone: 'default' },
  },
);

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export const calloutVariants = cva('rounded-lg border', {
  variants: {
    tone: {
      inset: 'border-border bg-inset',
      elevated: 'border-elevated-border bg-elevated-bg',
      critical: 'border-critical-border bg-critical-bg',
      ask: 'border-ask-border bg-ask-bg',
    },
  },
  defaultVariants: { tone: 'inset' },
});

export function Callout({ className, tone, ...props }: HTMLAttributes<HTMLDivElement> & VariantProps<typeof calloutVariants>) {
  return <div className={cn(calloutVariants({ tone }), className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('rounded-xl border bg-card text-card-foreground', className)} {...props} />;
}

export function Kbd({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className="inline-flex gap-[3px]">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className={cn(
            'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[4px] bg-muted px-[5px] font-sans text-xs font-medium leading-none text-muted-foreground',
            className,
          )}
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** shadcn's segmented tabs. */
export function Tabs({ className, children, label }: { className?: string; children: ReactNode; label: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex h-8 shrink-0 items-center rounded-lg bg-muted p-[3px]', className)}>
      {children}
    </div>
  );
}

export function Tab({ selected, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(
        'inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2.5 text-sm font-medium text-muted-foreground [&_svg]:size-3.5',
        selected && 'border-input bg-field-selected text-foreground shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

/** Underlined tabs, as in the workspace's right panel. */
export function LineTab({ selected, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(
        'inline-flex h-[38px] items-center gap-1.5 whitespace-nowrap px-2.5 text-sm font-medium text-muted-foreground shadow-[inset_0_-2px_0_transparent] [&_svg]:size-3.5',
        selected && 'text-foreground shadow-[inset_0_-2px_0_var(--foreground)]',
        className,
      )}
      {...props}
    />
  );
}

export function Switch({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[18px] w-8 shrink-0 rounded-full border border-transparent p-0',
        checked ? 'bg-primary' : 'bg-input',
        className,
      )}
    >
      <span
        className={cn(
          'absolute top-px size-3.5 rounded-full transition-[left] duration-100',
          checked ? 'left-[15px] bg-primary-foreground' : 'left-px bg-foreground',
        )}
      />
    </button>
  );
}

export const inputClass =
  'h-8 w-full select-text rounded-md border border-input bg-field px-2.5 text-base text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(inputClass, className)} {...props} />;
});

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative inline-flex">
      <select
        className={cn(
          'h-8 cursor-pointer appearance-none rounded-md border border-input bg-field pr-7 pl-2.5 text-base text-foreground [&_option]:bg-popover [&_option]:text-popover-foreground',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

export function Radio(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="radio"
      className="inline-grid size-4 shrink-0 cursor-pointer appearance-none place-content-center rounded-full border border-input bg-field checked:border-primary checked:before:size-2 checked:before:rounded-full checked:before:bg-primary checked:before:content-['']"
      {...props}
    />
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 shrink-0 overflow-hidden rounded-full bg-track', className)}>
      <span
        className="block h-full rounded-full bg-primary transition-[width] duration-200"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase', className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-3 animate-shimmer rounded-[4px] bg-[linear-gradient(90deg,var(--muted)_0%,var(--hover)_50%,var(--muted)_100%)] bg-size-[200%_100%]',
        className,
      )}
    />
  );
}

/** Window title bar: drag region, with room for macOS traffic lights. */
export function Titlebar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        'app-drag flex h-11 shrink-0 items-center gap-3 border-b bg-background px-3 [.platform-darwin_&]:pl-[84px] [&_button]:app-no-drag [&_input]:app-no-drag [&_select]:app-no-drag',
        className,
      )}
    >
      {children}
    </header>
  );
}
