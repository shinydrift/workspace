import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const navButtonVariants = cva(
  'w-full h-9 rounded-xl px-2 gap-2 flex items-center text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  {
    variants: {
      active: {
        true: 'bg-accent/80 text-foreground',
        false: 'text-muted-foreground hover:bg-accent/70',
      },
    },
    defaultVariants: { active: false },
  }
);

interface NavButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof navButtonVariants> {}

function NavButton({ className, active, ...props }: NavButtonProps) {
  return <button type="button" className={cn(navButtonVariants({ active }), className)} {...props} />;
}

export { NavButton, navButtonVariants };
