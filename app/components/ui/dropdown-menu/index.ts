import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

// A raised panel with a quiet edge and a top highlight, so menus lift off the conversation.
// Above dialogs (z-[70]), like selects: a menu opened inside one must show over it.
export const dropdownMenuContentClass =
  'dropdown-menu-panel z-[80] min-w-56 max-w-72 max-h-[var(--panel-available-height,calc(100dvh_-_16px))] overflow-y-auto rounded-lg border border-solid border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow),inset_0_1px_0_color-mix(in_srgb,var(--text)_6%,transparent)] outline-none'

// Highlight is a soft accent tint, with the icon taking the accent, rather than a solid fill.
export const dropdownMenuItemVariants = cva(
  'flex min-h-9 w-full cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[length:var(--ui-small)] font-[500] outline-none transition-colors duration-75 data-disabled:pointer-events-none data-disabled:opacity-45 [&>svg]:shrink-0 [@media(pointer:coarse)]:min-h-[44px]',
  {
    variants: {
      variant: {
        default:
          'text-body [&>svg]:text-muted-foreground data-highlighted:bg-primary/16 data-highlighted:text-foreground data-highlighted:[&>svg]:text-primary data-[state=open]:bg-primary/16 data-[state=open]:text-foreground data-[state=open]:[&>svg]:text-primary',
        destructive:
          'text-destructive [&>svg]:text-destructive data-highlighted:bg-destructive/14 data-highlighted:text-destructive',
        // A compact square in a row of quick actions (reactions).
        quick:
          'h-10 min-h-10 flex-1 justify-center rounded-lg bg-foreground/6 p-0 text-[20px] transition-[background,transform] data-highlighted:scale-110 data-highlighted:bg-primary/20',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)
export type DropdownMenuItemVariants = VariantProps<typeof dropdownMenuItemVariants>
