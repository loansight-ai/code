import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ComponentProps } from 'react'

// shadcn/ui Button composition; styled with the project's KB tokens.
const variants = cva('button', {
  variants: {
    variant: {
      primary: 'button-primary',
      outline: 'button-outline',
      ghost: 'button-ghost',
    },
  },
  defaultVariants: { variant: 'primary' },
})

export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button'
  return (
    <Component
      className={twMerge(clsx(variants({ variant }), className))}
      {...props}
    />
  )
}
