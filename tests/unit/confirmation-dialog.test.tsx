import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmationDialog } from '../../components/ui/confirmation-dialog';

function renderDialog(overrides: Partial<Parameters<typeof ConfirmationDialog>[0]> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();

  render(
    <ConfirmationDialog
      open
      title="Send the confirmation email?"
      confirmLabel="Send confirmation email"
      cancelLabel="Go back"
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    >
      <p>person@example.com</p>
    </ConfirmationDialog>,
  );

  return { onCancel, onConfirm };
}

describe('ConfirmationDialog', () => {
  it('renders nothing until it is opened', () => {
    renderDialog({ open: false });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts focus on Cancel so a stray Enter does not commit the action', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Go back' })).toHaveFocus();
  });

  it('names the action on its button rather than saying OK', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Send confirmation email' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ok$/i })).toBeNull();
  });

  it('describes itself to assistive technology', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Send the confirmation email?');
  });

  it('closes on Escape', () => {
    const { onCancel, onConfirm } = renderDialog();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('traps Tab inside the dialog', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    const cancel = screen.getByRole('button', { name: 'Go back' });
    const confirm = screen.getByRole('button', { name: 'Send confirmation email' });

    // Forward from the last control wraps to the first.
    confirm.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(cancel).toHaveFocus();

    // Backward from the first control wraps to the last.
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it('reports the choice the visitor made', () => {
    const { onCancel, onConfirm } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Send confirmation email' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels when the backdrop is clicked, never confirms', () => {
    const { onCancel, onConfirm } = renderDialog();

    fireEvent.click(screen.getByTestId('confirmation-dialog-backdrop'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables both controls while the action is running', () => {
    renderDialog({ busy: true, busyLabel: 'Sending…' });

    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeDisabled();
  });
});
