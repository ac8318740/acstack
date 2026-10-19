import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommentEditor } from '../comment-editor.js';

const state = vi.hoisted(() => ({ text: undefined as string | undefined }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: string) => [state.text ?? initial, (next: string) => { state.text = next; }],
  useId: () => 'edit-comment',
}));
type Props = {
  children?: ReactNode; value?: string; disabled?: boolean; htmlFor?: string; id?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onClick?: () => void;
  onKeyDown?: (event: { key: string; ctrlKey?: boolean; metaKey?: boolean; preventDefault: () => void; stopPropagation: () => void }) => void;
};
function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}
const onSave = vi.fn();
const onCancel = vi.fn();
function editor() { return elements(CommentEditor({ comment: 'Original feedback', onSave, onCancel })); }
function field() { return editor().find(node => node.type === 'textarea')!; }
function save() { return editor().find(node => node.type === 'button' && node.props.children === 'Save')!; }
beforeEach(() => { state.text = undefined; onSave.mockReset(); onCancel.mockReset(); });
it('prefills a visibly labeled editor with Save and Cancel', () => {
  expect(field().props.value).toBe('Original feedback');
  expect(editor().find(node => node.type === 'label')?.props.htmlFor).toBe(field().props.id);
  expect(save()).toBeDefined();
  expect(editor().some(node => node.type === 'button' && node.props.children === 'Cancel')).toBe(true);
});
it('rejects whitespace and trims the edited comment before saving', () => {
  field().props.onChange!({ target: { value: '  \n ' } });
  expect(save().props.disabled).toBe(true);
  save().props.onClick!();
  expect(onSave).not.toHaveBeenCalled();
  field().props.onChange!({ target: { value: '  Updated feedback \n ' } });
  save().props.onClick!();
  expect(onSave).toHaveBeenCalledExactlyOnceWith('Updated feedback');
});
it('cancels with either Cancel or Escape without saving', () => {
  field().props.onChange!({ target: { value: 'Discard this' } });
  editor().find(node => node.type === 'button' && node.props.children === 'Cancel')!.props.onClick!();
  const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
  field().props.onKeyDown!(event);
  expect(onCancel).toHaveBeenCalledTimes(2);
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
});
it.each(['ctrlKey', 'metaKey'])('saves with %s + Enter', modifier => {
  const event = { key: 'Enter', [modifier]: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  field().props.onKeyDown!(event);
  expect(onSave).toHaveBeenCalledExactlyOnceWith('Original feedback');
  expect(event.preventDefault).toHaveBeenCalledOnce();
});
