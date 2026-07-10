import { useEffect, useRef } from 'react'

export function ModalDialog({
  open,
  onClose,
  labelledBy,
  children
}: {
  open: boolean
  onClose: () => void
  labelledBy?: string
  children: React.ReactNode
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      if (!dialog.open) {
        previousFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
        dialog.showModal()
      }
      return
    }

    if (dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const restoreFocus = (): void => {
      const previous = previousFocusRef.current
      previousFocusRef.current = null
      if (previous && document.contains(previous)) {
        previous.focus()
      }
    }

    const handleClose = (): void => {
      restoreFocus()
      onClose()
    }

    const handleCancel = (event: Event): void => {
      event.preventDefault()
      onClose()
    }

    const handleBackdrop = (event: Event): void => {
      if (event.target === dialog) {
        onClose()
      }
    }

    dialog.addEventListener('close', handleClose)
    dialog.addEventListener('cancel', handleCancel)
    dialog.addEventListener('pointerdown', handleBackdrop)
    dialog.addEventListener('click', handleBackdrop)

    return () => {
      dialog.removeEventListener('close', handleClose)
      dialog.removeEventListener('cancel', handleCancel)
      dialog.removeEventListener('pointerdown', handleBackdrop)
      dialog.removeEventListener('click', handleBackdrop)
    }
  }, [onClose])

  return (
    <dialog ref={dialogRef} className="modal" aria-labelledby={labelledBy}>
      <div className="modal__body">{children}</div>
    </dialog>
  )
}
