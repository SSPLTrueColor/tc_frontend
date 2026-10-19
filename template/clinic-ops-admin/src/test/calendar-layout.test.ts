import { describe, expect, it } from 'vitest';
import { layoutEvents } from '../components/resource/CalendarView';

describe('calendar overlap layout', () => {
  it('puts overlapping bookings side by side and leaves others full width', () => {
    const rows = [
      { id: 'a', start: '2026-10-16T10:45', dur: 30 },
      { id: 'b', start: '2026-10-16T11:00', dur: 30 },
      { id: 'c', start: '2026-10-16T13:00', dur: 30 },
    ];
    const out = Object.fromEntries(layoutEvents(rows as never, 'start', 'dur').map((e) => [e.r.id, [e.col, e.cols]]));
    expect(out).toEqual({ a: [0, 2], b: [1, 2], c: [0, 1] });
  });
});
