import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from '@shared/lib/cn';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ComponentPropsWithoutRef, ComponentRef } from 'react';
import { forwardRef } from 'react';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = forwardRef<
    ComponentRef<typeof SelectPrimitive.Trigger>,
    ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger
        ref={ref}
        className={cn(
            'flex h-10 items-center justify-between gap-2 rounded-xl border border-border bg-input-bg px-3 py-2 text-sm font-[450] leading-5 text-primary shadow-xs outline-none transition-colors',
            'hover:border-strong-border cursor-pointer select-none whitespace-nowrap',
            'focus-visible:ring-2 focus-visible:ring-strong-border/40',
            'disabled:cursor-not-allowed disabled:opacity-50',
            '[&>span]:line-clamp-1',
            className,
        )}
        {...props}
    >
        {children}
        <SelectPrimitive.Icon asChild>
            <ChevronDown size={11} strokeWidth={2.5} className="shrink-0 text-muted" />
        </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectScrollUpButton = forwardRef<
    ComponentRef<typeof SelectPrimitive.ScrollUpButton>,
    ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
    <SelectPrimitive.ScrollUpButton
        ref={ref}
        className={cn('flex cursor-default items-center justify-center py-1', className)}
        {...props}
    >
        <ChevronUp size={12} strokeWidth={2} className="text-muted" />
    </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

export const SelectScrollDownButton = forwardRef<
    ComponentRef<typeof SelectPrimitive.ScrollDownButton>,
    ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
    <SelectPrimitive.ScrollDownButton
        ref={ref}
        className={cn('flex cursor-default items-center justify-center py-1', className)}
        {...props}
    >
        <ChevronDown size={12} strokeWidth={2} className="text-muted" />
    </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

export const SelectContent = forwardRef<
    ComponentRef<typeof SelectPrimitive.Content>,
    ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
    <SelectPrimitive.Portal>
        <SelectPrimitive.Content
            ref={ref}
            className={cn(
                'z-1100 max-h-56 min-w-[6rem] overflow-hidden rounded-lg bg-main-bg shadow-ring',
                'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out',
                'motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=open]:fade-in-0',
                'motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[state=open]:zoom-in-95',
                'motion-safe:data-[side=bottom]:slide-in-from-top-2 motion-safe:data-[side=top]:slide-in-from-bottom-2',
                position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
                className,
            )}
            position={position}
            {...props}
        >
            <SelectScrollUpButton />
            <SelectPrimitive.Viewport
                className={cn('p-1', position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]')}
            >
                {children}
            </SelectPrimitive.Viewport>
            <SelectScrollDownButton />
        </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectLabel = forwardRef<
    ComponentRef<typeof SelectPrimitive.Label>,
    ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
    <SelectPrimitive.Label
        ref={ref}
        className={cn('px-2 py-1 text-[11px] font-medium uppercase tracking-[0.5px] text-muted', className)}
        {...props}
    />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export const SelectItem = forwardRef<
    ComponentRef<typeof SelectPrimitive.Item>,
    ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
    <SelectPrimitive.Item
        ref={ref}
        className={cn(
            'relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-7 pr-2.5 text-sm tracking-[0.14px] text-secondary transition',
            'hover:bg-surface hover:text-primary',
            'focus:bg-surface focus:text-primary',
            'focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-secondary',
            'data-[state=checked]:font-medium data-[state=checked]:text-primary',
            'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
            className,
        )}
        {...props}
    >
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
            <SelectPrimitive.ItemIndicator>
                <Check size={11} strokeWidth={2.5} className="text-primary" />
            </SelectPrimitive.ItemIndicator>
        </span>
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export const SelectSeparator = forwardRef<
    ComponentRef<typeof SelectPrimitive.Separator>,
    ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
    <SelectPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border-subtle', className)} {...props} />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;
