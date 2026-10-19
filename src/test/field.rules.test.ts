import { achievementFor, attendanceMetrics, conveyanceAmount, expenseLimit, geofenceCheck, OFFICE, periodLabel, periodRange, periodStartFor, routeDistanceKm } from '../domain/modules/field/rules';

const SHIFT = { start: '09:30', end: '18:30', graceMin: 15, halfDayHours: 4.5 };

describe('shift rules (BR-43)', () => {
  it('is on time within the grace period and late after it (counted from shift start)', () => {
    expect(attendanceMetrics({ checkInAt: '2026-10-19T09:45', status: 'present' }, SHIFT).lateByMin).toBe(0);
    expect(attendanceMetrics({ checkInAt: '2026-10-19T09:46', status: 'present' }, SHIFT).lateByMin).toBe(16);
  });
  it('computes worked minutes, early exit and half-day', () => {
    const full = attendanceMetrics({ checkInAt: '2026-10-19T09:20', checkOutAt: '2026-10-19T18:40', status: 'present' }, SHIFT);
    expect(full).toEqual({ workMinutes: 560, lateByMin: 0, earlyByMin: 0, status: 'present' });
    const early = attendanceMetrics({ checkInAt: '2026-10-19T09:20', checkOutAt: '2026-10-19T17:00', status: 'present' }, SHIFT);
    expect(early.earlyByMin).toBe(90);
    expect(early.status).toBe('present');
    const half = attendanceMetrics({ checkInAt: '2026-10-19T09:20', checkOutAt: '2026-10-19T13:30', status: 'present' }, SHIFT);
    expect(half.status).toBe('half_day');
  });
  it('keeps on-tour status even for a short day; no check-in means absent', () => {
    expect(attendanceMetrics({ checkInAt: '2026-10-19T09:20', checkOutAt: '2026-10-19T12:00', status: 'on_tour' }, SHIFT).status).toBe('on_tour');
    expect(attendanceMetrics({ status: 'present' }, SHIFT).status).toBe('absent');
  });
});

describe('location and expenses (BR-42, BR-46)', () => {
  it('geofence and distance', () => {
    expect(geofenceCheck({ lat: OFFICE.lat + 0.0005, lng: OFFICE.lng }, 200).inside).toBe(true);
    expect(geofenceCheck({ lat: 19.076, lng: 72.8777 }, 200).inside).toBe(false);
    const km = routeDistanceKm([{ lat: 19.076, lng: 72.8777 }, { lat: 18.5204, lng: 73.8567 }]);
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(130);
  });
  it('conveyance = km × rate; limits per type', () => {
    expect(conveyanceAmount(42.5, 'two_wheeler', { twoWheeler: 4, car: 9 })).toBe(170);
    expect(conveyanceAmount(10, 'car', { twoWheeler: 4, car: 9 })).toBe(90);
    expect(expenseLimit('conveyance', 'car', { twoWheeler: 4, car: 9 })).toBe(1350);
    expect(expenseLimit('food', 'two_wheeler', { twoWheeler: 4, car: 9 })).toBe(600);
  });
});

describe('target periods and achievement (TGT-01, BR-47)', () => {
  it('normalises periods to Indian financial quarters and years', () => {
    expect(periodStartFor('quarter', '2026-10-19')).toBe('2026-10-01');
    expect(periodStartFor('quarter', '2027-02-10')).toBe('2027-01-01');
    expect(periodStartFor('year', '2027-02-10')).toBe('2026-04-01');
    expect(periodRange('quarter', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2027-01-01' });
    expect(periodRange('year', '2026-04-01')).toEqual({ from: '2026-04-01', to: '2027-04-01' });
    expect(periodLabel('quarter', '2026-10-01')).toBe('Q3 FY 2026-27');
    expect(periodLabel('quarter', '2027-01-01')).toBe('Q4 FY 2026-27');
  });

  const data = {
    products: [
      { id: 'P1', productType: 'machine' },
      { id: 'P2', productType: 'ink' },
    ],
    salesOrders: [
      { id: 'SO1', ownerId: 'E1', divisionId: 'TX', customerId: 'C1', status: 'confirmed', orderDate: '2026-10-05', grandTotal: 1_180_000, lines: [{ productId: 'P1', qty: 1, listPrice: 1_000_000 }, { productId: 'P2', qty: 10, listPrice: 5000, discountPct: 10 }] },
      { id: 'SO2', ownerId: 'E1', divisionId: 'TX', customerId: 'C2', status: 'pending_approval', orderDate: '2026-10-06', grandTotal: 500_000, lines: [] },
      { id: 'SO3', ownerId: 'E2', divisionId: 'TX', customerId: 'C1', status: 'completed', orderDate: '2026-09-01', grandTotal: 300_000, lines: [] },
      { id: 'SO4', ownerId: 'E1', divisionId: 'TX', customerId: 'C3', status: 'cancelled', orderDate: '2026-10-07', grandTotal: 900_000, lines: [] },
    ],
    paymentMilestones: [
      { id: 'PM1', salesOrderId: 'SO1', receivedAmount: 400_000, receivedAt: '2026-10-10' },
      { id: 'PM2', salesOrderId: 'SO3', receivedAmount: 100_000, receivedAt: '2026-10-11' },
    ],
    activities: [
      { id: 'A1', byId: 'E1', at: '2026-10-02T10:00' },
      { id: 'A2', byId: 'E1', at: '2026-09-30T10:00' },
    ],
  };
  const t = (metric: string, extra = {}) => ({ metric, periodType: 'month', periodStart: '2026-10-01', ...extra });
  const e1 = (o: unknown) => o === 'E1';

  it('counts only booked orders in the period, optionally by product type', () => {
    // Order value = line value net of discount, before GST (same basis with or without a category): 1,000,000 + 45,000.
    expect(achievementFor(t('order_value'), data, e1)).toBe(1_045_000);
    expect(achievementFor(t('order_value', { productCategory: 'ink' }), data, e1)).toBe(45_000);
    expect(achievementFor(t('quantity', { productCategory: 'ink' }), data, e1)).toBe(10);
  });
  it('collections, new customers and activities', () => {
    expect(achievementFor(t('collections'), data, e1)).toBe(400_000);
    expect(achievementFor(t('collections'), data, () => true)).toBe(500_000);
    // C1 first ordered in September (SO3), so October's SO1 is not a new customer
    expect(achievementFor(t('new_customers'), data, e1)).toBe(0);
    expect(achievementFor(t('activities'), data, e1)).toBe(1);
  });
});
