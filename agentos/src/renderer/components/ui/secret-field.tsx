import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { FieldMessage } from '@/components/ui/field-message';

interface SecretFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helper?: React.ReactNode;
  rightAction?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export function SecretField({
  id,
  label,
  value,
  onChange,
  placeholder,
  helper,
  rightAction,
  disabled,
  className,
}: SecretFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {rightAction ? (
        <div className="flex items-center justify-between">
          <Label htmlFor={id}>{label}</Label>
          {rightAction}
        </div>
      ) : (
        <Label htmlFor={id}>{label}</Label>
      )}
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
      />
      {helper && <FieldMessage>{helper}</FieldMessage>}
    </div>
  );
}
