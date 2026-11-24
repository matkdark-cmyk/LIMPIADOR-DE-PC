import { useEffect } from 'react';

/**
 * Cierra un modal al pulsar la tecla Escape mientras esté abierto y no bloqueado.
 */
export function useEscapeKey(
  isOpen: boolean,
  onClose: () => void,
  disabled = false,
): void {
  useEffect(() => {
    if (!isOpen || disabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, disabled]);
}
