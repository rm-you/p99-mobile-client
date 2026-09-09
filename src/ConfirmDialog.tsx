import { useLayoutEffect, useRef } from "react";

/** Native modal traps focus and asks before saving credentials or performing destructive actions. */
export default function ConfirmDialog({
  title,
  description,
  confirm,
  cancel = "Cancel",
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirm: string;
  cancel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="item-modal confirm-dialog"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-description"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="confirmation-title">{title}</h2>
      <p id="confirmation-description">{description}</p>
      <div className="confirm-actions">
        <button autoFocus className="secondary-button" onClick={onCancel}>
          {cancel}
        </button>
        <button className="secondary-button" onClick={onConfirm}>
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
