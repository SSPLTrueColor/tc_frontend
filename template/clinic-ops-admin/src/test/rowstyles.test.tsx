import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AvatarStack, ImageTile, initialsOf } from '../components/primitives/People';

describe('row presentation primitives', () => {
  it('initials tile when there is no image, picture when there is one', () => {
    const { container, rerender } = render(<ImageTile name="Dr. Amara Osei" />);
    expect(container.textContent).toBe('AO');
    rerender(<ImageTile name="Amara" src="data:image/svg+xml;utf8,<svg/>" />);
    expect(container.querySelector('img')).not.toBeNull();
    expect(initialsOf('Ananya Patel')).toBe('AP');
  });
  it('people stack shows 3 avatars then "+N"; hover opens the people card', async () => {
    const people = ['Ana Sousa', 'Theo Lindqvist', 'Mei Tanaka', 'Sam Whitfield', 'Rhea Kapoor'].map((name) => ({ name, subtitle: 'Nurse' }));
    render(<AvatarStack people={people} />);
    const stack = screen.getByRole('button', { name: /5 people assigned/ });
    expect(stack.querySelectorAll('.img-tile')).toHaveLength(3);
    expect(stack.textContent).toContain('+2');
    fireEvent.mouseEnter(stack);
    const card = await screen.findByRole('dialog', { name: /5 people assigned/ });
    expect(card.querySelectorAll('.people-card-row')).toHaveLength(5);
    expect(card.textContent).toContain('Rhea Kapoor');
  });
});
