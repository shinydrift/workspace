import { cn } from '@/lib/utils';

interface SpinnerProps {
  className?: string;
  size?: 'sm' | 'default';
}

export function Spinner({ className, size = 'default' }: SpinnerProps) {
  return (
    <span
      className={cn(
        'inline-flex animate-spin rounded-full border border-muted-foreground/50 border-t-transparent',
        size === 'sm' ? 'h-3 w-3' : 'h-4 w-4',
        className
      )}
    />
  );
}
