import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({
  title,
  description,
  open,
  onOpenChange,
  children,
  onCloseAutoFocus,
  variant = 'modal',
}: {
  title: string
  description: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  onCloseAutoFocus?: (event: Event) => void
  variant?: 'modal' | 'drawer'
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal-content ${variant === 'drawer' ? 'source-drawer' : ''}`}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <Dialog.Close className="modal-close" aria-label="닫기">
            <X size={20} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
