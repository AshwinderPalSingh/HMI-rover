import { TriangleAlert } from 'lucide-react';
import { app, useApp } from '../../state/store';
import { Button, Dialog } from '../ui';

export function ConfirmDialog() {
  const c = useApp((s) => s.confirm);
  if (!c) return null;
  const close = () => app().patch({ confirm: null });
  return (
    <Dialog
      title={c.title}
      icon={TriangleAlert}
      onClose={close}
      width={400}
      initialFocus=".dialog__foot .btn--ghost"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant={c.danger ? 'danger' : 'primary'}
            onClick={() => {
              close();
              c.onConfirm();
            }}
          >
            {c.confirmLabel}
          </Button>
        </>
      }
    >
      <p>{c.body}</p>
    </Dialog>
  );
}
