/**
 * Service demo data: ~220 tickets over the last 6 months on seeded machines/customers (every status,
 * SLA met and breached, repeat complaints, customer ratings), their engineer visits, PM visit
 * status normalisation and ~25 knowledge-base articles. Upstream data is optional.
 * Imports only lib/* (no services) to keep the store → seed import chain acyclic.
 */
import { addDays, addMinutes, parseLocal, toLocalDateTime } from '../lib/dates';
import type { RecordData } from '../metadata/types';
import type { SeedContext } from './context';

export const rev = 3;

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Same defaults as services/policies.ts DEFAULT_POLICIES.sla (hours: response, arrival, resolution). */
const SLA: Record<string, Record<string, [number, number, number]>> = {
  critical: { cmc: [1, 4, 8], amc: [1, 4, 8], warranty: [1, 4, 8], none: [2, 8, 24] },
  high: { cmc: [2, 8, 24], amc: [2, 8, 24], warranty: [2, 8, 24], none: [4, 24, 48] },
  medium: { cmc: [4, 24, 48], amc: [4, 24, 48], warranty: [4, 24, 48], none: [8, 48, 72] },
  low: { cmc: [8, 48, 96], amc: [8, 48, 96], warranty: [8, 48, 96], none: [24, 72, 120] },
};

const COMPLAINTS: [string, string, string][] = [
  ['print_head', 'nozzle_missing', 'Missing nozzles on head 2, test print shows white lines'],
  ['print_head', 'head_error', 'Head not detected after power cut'],
  ['print_quality', 'banding', 'Horizontal banding on sublimation prints'],
  ['print_quality', 'colour_shift', 'Colours shifted after RIP profile change'],
  ['ink_system', 'ink_leak', 'Ink leaking near the damper on cyan channel'],
  ['ink_system', 'ink_starvation', 'Ink starvation on magenta during long runs'],
  ['mechanical', 'belt', 'Belt slipping, prints stretched at the end of the roll'],
  ['mechanical', 'feed_jam', 'Fabric jamming at the take-up roller'],
  ['electrical', 'power_trip', 'Machine trips the MCB when the heater starts'],
  ['electrical', 'heater', 'Dryer not reaching set temperature'],
  ['software_rip', 'rip_crash', 'RIP software crashes while ripping large files'],
  ['software_rip', 'licence', 'RIP licence dongle not recognised'],
  ['media_feed', 'skew', 'Media skewing after 20 metres'],
];
const CONSUMABLE: [string, string, string][] = [
  ['consumable_quality', 'ink_quality', 'Ink batch shows lower density than previous lot'],
  ['consumable_quality', 'paper_quality', 'Paper curling in humid conditions'],
  ['consumable_quality', 'fabric_quality', 'Fabric shade variation across rolls'],
];

const KB: [string, string, string, string, string, string][] = [
  ['Clearing missing nozzles after long idle time', 'TX-1800, TX-3200', 'E-201', 'print_head', 'White lines on nozzle check after the machine was idle', 'Run 2 strong cleans, soak the cap with flush for 10 minutes, then normal clean. Replace wiper if worn.'],
  ['Head not detected after power cut', 'TX-1800, TX-3200, POD-640', 'E-310', 'print_head', 'Head error on boot, head board LED off', 'Check FFC cables for burns, reseat head board, verify 42 V rail. Use a UPS to avoid repeat.'],
  ['Banding on sublimation prints', 'TX-1800', 'B-01', 'print_quality', 'Horizontal bands every pass', 'Run feed calibration, check encoder strip for ink mist, clean with IPA.'],
  ['Cyan damper leakage', 'TX-1800, TX-3200', 'I-104', 'ink_system', 'Ink drops below the carriage', 'Replace damper and O-ring kit; check negative pressure setting.'],
  ['Ink starvation during long runs', 'TX-3200', 'I-117', 'ink_system', 'Fading colour after 30 m', 'Check sub-tank float sensor and pump, clean inline filter.'],
  ['Belt slipping and stretched prints', 'TX-3200', 'M-022', 'mechanical', 'Print length grows towards roll end', 'Re-tension belt per service manual, replace if glazed, re-run feed calibration.'],
  ['Fabric jamming at take-up', 'TX-1800, TX-3200', 'M-040', 'mechanical', 'Fabric bunching at take-up roller', 'Adjust take-up torque, check tension bar sensor, align rollers.'],
  ['Heater trips the MCB', 'TX-3200', 'P-005', 'electrical', 'MCB trips when dryer starts', 'Check heater element insulation, earth leakage; confirm 32 A dedicated line.'],
  ['Dryer not reaching temperature', 'TX-1800, TX-3200', 'P-012', 'electrical', 'Prints not dry at end of dryer', 'Clean thermocouple, check SSR, verify set point in firmware.'],
  ['RIP crash on large files', 'RIP Pro 8', 'R-500', 'software_rip', 'RIP closes while ripping > 2 GB TIFF', 'Increase scratch disk space, update RIP to latest build, disable preview for large jobs.'],
  ['RIP dongle not recognised', 'RIP Pro 8', 'R-404', 'software_rip', 'Licence error on start', 'Reinstall dongle driver, try another USB port, check Windows update blocking driver.'],
  ['Media skew after 20 m', 'POD-640, LBL-330', 'F-003', 'media_feed', 'Paper drifts to one side', 'Re-centre pinch rollers, check media guide, verify roll core is straight.'],
  ['Colour shift after profile change', 'TX-1800, POD-640', 'C-002', 'print_quality', 'Colours do not match proofs', 'Re-linearise and rebuild ICC profile for the media; lock profile per job.'],
  ['Label press web wandering', 'LBL-330', 'L-021', 'media_feed', 'Web drifts off guides', 'Adjust web guide sensor, check unwind brake tension.'],
  ['Die station misregistration', 'LBL-330', 'L-030', 'mechanical', 'Cut not aligned with print', 'Calibrate registration mark sensor, clean sensor window.'],
  ['POD cutter not cutting through', 'POD-640', 'P-120', 'mechanical', 'Cuts leave material attached', 'Replace cutter blade, set cut depth per media.'],
  ['Head strike on thick fabric', 'TX-3200', 'E-215', 'print_head', 'Head rubs fabric, smudges', 'Raise head height, check fabric flatness and tension, verify vacuum.'],
  ['Ink density low on new batch', 'All ink', 'INK-QC', 'consumable_quality', 'Prints lighter after new ink lot', 'Record lot number, print density chart, compare with retained sample; raise QC complaint.'],
  ['Paper curling in humidity', 'All paper', 'PPR-01', 'consumable_quality', 'Paper curls, head strikes', 'Store in original packing at 40–60% RH, acclimatise 24 h before use.'],
  ['Fabric shade variation', 'All fabric', 'FAB-02', 'consumable_quality', 'Shade differs between rolls', 'Check pre-treatment batch, keep rolls of one lot per job, report lot numbers.'],
  ['Encoder strip cleaning', 'TX-1800, TX-3200, POD-640', 'M-010', 'mechanical', 'Random position errors', 'Clean strip with lint-free cloth and IPA, never use water.'],
  ['Firmware update procedure', 'TX-1800, TX-3200', 'FW', 'software_rip', 'Release notes require update', 'Back up settings, update via USB, restore settings, run head alignment.'],
  ['Earthing check before installation', 'All machines', 'SITE-01', 'electrical', 'Static, random errors', 'Neutral–earth voltage must be below 2 V; fix earthing before commissioning.'],
  ['Cap station cleaning', 'TX-1800, TX-3200', 'E-220', 'print_head', 'Nozzles drop after capping', 'Clean cap tops weekly, replace caps every 6 months.'],
  ['UPS sizing for printers', 'All machines', 'SITE-02', 'electrical', 'Power cuts damage heads', 'Use online UPS sized for printer + heater excluded; dryer on separate line.'],
];

export function seed(ctx: SeedContext): void {
  const { rnd, now, today } = ctx;
  const R = ctx.records;
  const customers = (R.customers ?? []).filter((c) => c.status !== 'inactive');
  const machines = (R.machines ?? []).filter((m) => m.status !== 'scrapped');
  const engineers = (R.employees ?? []).filter((e) => e.roleId === 'engineer');
  const contactsOf = (cid: string) => (R.contacts ?? []).filter((c) => c.customerId === cid);
  const coverageOf = (machineId: string, day: string) => {
    const amc = (R.amcContracts ?? []).filter((c) => c.machineId === machineId && ['active', 'due_for_renewal', 'renewed', 'expired'].includes(s(c.status)) && s(c.startDate) <= day && s(c.endDate) >= day);
    if (amc.some((c) => c.contractType === 'cmc')) return 'cmc';
    if (amc.some((c) => c.contractType === 'amc')) return 'amc';
    return (R.warranties ?? []).some((w) => w.machineId === machineId && s(w.startDate) <= day && s(w.endDate) >= day) ? 'warranty' : 'none';
  };
  const engineerFor = (div: string, territory: string) => {
    const pool = engineers.filter((e) => ((e.divisionIds as string[]) ?? []).includes(div));
    const local = pool.filter((e) => ((e.territoryIds as string[]) ?? []).includes(territory));
    return (local.length && rnd.chance(0.7) ? rnd.pick(local) : pool.length ? rnd.pick(pool) : engineers.length ? rnd.pick(engineers) : null)?.id ?? null;
  };
  const coordinators = (R.employees ?? []).filter((e) => e.roleId === 'coordinator').map((e) => e.id);
  const nowLocal = toLocalDateTime(now);
  const at = (base: string, hours: number) => addMinutes(base, Math.round(hours * 60));
  const tickets: RecordData[] = (R.tickets ??= []);
  const visits: RecordData[] = (R.serviceVisits ??= []);

  // ---------------------------------------------------------------- tickets
  const consumerCustomers = customers.filter((c) => ((c.divisionIds as string[]) ?? []).some((d) => ['INK', 'PPR', 'FAB'].includes(d)));
  const targets: { customer: RecordData; machine?: RecordData; div: string }[] = [];
  machines.forEach((m) => {
    const c = customers.find((x) => x.id === m.customerId);
    if (c) targets.push({ customer: c, machine: m, div: s(m.divisionId) });
  });
  consumerCustomers.forEach((c) => targets.push({ customer: c, div: ((c.divisionIds as string[]) ?? []).find((d) => ['INK', 'PPR', 'FAB'].includes(d)) ?? 'INK' }));

  if (targets.length) {
    const COUNT = 220;
    const recentByMachineCat = new Map<string, RecordData>();
    for (let i = 0; i < COUNT; i++) {
      // Older tickets first so repeat detection and ids follow time.
      const ageDays = Math.round(180 - (i / COUNT) * 180 + rnd.int(-2, 2));
      const target = rnd.chance(0.82) && machines.length ? rnd.pick(targets.filter((t) => t.machine).length ? targets.filter((t) => t.machine) : targets) : rnd.pick(targets);
      const machine = target.machine;
      const day = addDays(today, -Math.max(0, ageDays));
      const reportedAt = `${day}T${String(rnd.int(9, 18)).padStart(2, '0')}:${rnd.pick(['00', '15', '30', '45'])}`;
      if (reportedAt > nowLocal) continue;
      const [category, subCategory, description] = machine ? rnd.pick(COMPLAINTS) : rnd.pick(CONSUMABLE);
      const priority = rnd.pick(['critical', 'high', 'high', 'medium', 'medium', 'medium', 'low']);
      const coverage = machine ? coverageOf(machine.id, day) : 'none';
      const [hr, ha, hs] = SLA[priority][coverage];
      const ticketType = machine ? rnd.pick(['breakdown', 'breakdown', 'breakdown', 'remote_support', 'breakdown', 'training', 'relocation', 'spare_only']) : 'breakdown';
      const assignee = engineerFor(target.div, s(target.customer.territoryId));
      const contact = contactsOf(target.customer.id)[0];
      const key = `${machine?.id}:${category}`;
      const prior = machine ? recentByMachineCat.get(key) : undefined;
      const repeatOfId = prior && s(prior.reportedAt).slice(0, 10) >= addDays(day, -30) ? prior.id : null;
      // Status by age: recent tickets are still moving; old ones are closed.
      const status =
        ageDays <= 1
          ? rnd.pick(['open', 'open', 'assigned', 'accepted'])
          : ageDays <= 5
            ? rnd.pick(['assigned', 'accepted', 'in_progress', 'in_progress', 'waiting_parts', 'waiting_customer', 'customer_confirmation'])
            : ageDays <= 12
              ? rnd.pick(['in_progress', 'waiting_parts', 'customer_confirmation', 'closed', 'closed'])
              : rnd.chance(0.04)
                ? 'reopened'
                : 'closed';
      const late = rnd.chance(0.22); // ~ 1 in 5 misses an SLA
      const respondedAt = status === 'open' ? null : at(reportedAt, hr * (late && rnd.chance(0.5) ? rnd.next() + 1.1 : rnd.next() * 0.9));
      const progressed = !['open', 'assigned', 'accepted'].includes(status);
      const arrivedAt = progressed ? at(reportedAt, ha * (late ? 1 + rnd.next() * 0.8 : 0.3 + rnd.next() * 0.6)) : null;
      const done = ['customer_confirmation', 'closed'].includes(status);
      const resolvedAt = done ? at(reportedAt, hs * (late ? 1 + rnd.next() : 0.4 + rnd.next() * 0.5)) : null;
      const capped = (v: string | null) => (v && v > nowLocal ? nowLocal : v);
      const dues = { responseDueAt: at(reportedAt, hr), arrivalDueAt: at(reportedAt, ha), resolutionDueAt: at(reportedAt, hs) };
      const r = capped(respondedAt);
      const a = capped(arrivedAt);
      const sres = capped(resolvedAt);
      const breached = (!!r && r > dues.responseDueAt) || (!!a && a > dues.arrivalDueAt) || (!!sres && sres > dues.resolutionDueAt) || (!r && nowLocal > dues.responseDueAt) || (!a && progressed && nowLocal > dues.arrivalDueAt) || (!sres && !done && nowLocal > dues.resolutionDueAt);
      const rating = status === 'closed' ? (rnd.chance(0.08) ? rnd.int(1, 2) : rnd.int(3, 5)) : null;
      const chargeable = coverage === 'none' && machine && !['installation', 'pm', 'training'].includes(ticketType);
      const id = ctx.nextId('tickets', 'TKT', 'fy', parseLocal(reportedAt));
      const t: RecordData = {
        ...ctx.base(ageDays, rnd.pick([...coordinators, 'system'].filter(Boolean))),
        id,
        customerId: target.customer.id,
        machineId: machine?.id ?? null,
        contactId: contact?.id ?? null,
        channel: rnd.pick(['phone', 'phone', 'phone', 'whatsapp', 'email', 'portal', 'engineer_app']),
        reportedAt,
        description,
        category,
        subCategory,
        ticketType,
        priority,
        coverage,
        divisionId: target.div,
        assigneeId: status === 'open' ? null : assignee,
        status,
        ...dues,
        respondedAt: r,
        arrivedAt: a,
        resolvedAt: sres,
        closedAt: status === 'closed' && sres ? capped(at(sres, 24 * rnd.int(1, 3))) : null,
        slaBreached: breached,
        escalationLevel: breached && !done ? 1 : 0,
        resolution: done || status === 'reopened' ? rnd.pick(['Cleaned heads and replaced damper; test print OK.', 'Recalibrated feed and encoder; banding gone.', 'Replaced head board; machine running.', 'Updated RIP and reinstalled driver.', 'Adjusted tension and aligned rollers.', 'Advised storage and replaced consumable lot.']) : '',
        repeatOfId,
        rootCause: repeatOfId && status === 'closed' ? rnd.pick(['Unstable power supply at site — UPS recommended', 'Operator skipped daily cleaning', 'Worn wiper blade not replaced on first visit']) : '',
        rating,
        feedbackComment: rating ? (rating <= 2 ? rnd.pick(['Engineer came late, machine down for two days', 'Same problem again within a month']) : rnd.pick(['Quick response, thanks', 'Good work', '', 'Engineer explained the cleaning routine'])) : '',
        reopenCount: status === 'reopened' ? 1 : 0,
        remoteSteps: ticketType === 'remote_support' && progressed ? 'Guided operator through head cleaning and nozzle check over video call.' : '',
        remoteDurationMin: ticketType === 'remote_support' && progressed ? rnd.int(15, 60) : null,
        remoteSessionRef: ticketType === 'remote_support' && progressed ? `AnyDesk ${rnd.int(100, 999)} ${rnd.int(100, 999)} ${rnd.int(100, 999)}` : '',
        chargeableStatus: chargeable ? (done ? 'billing_requested' : progressed ? 'approved' : 'quoted') : 'none',
        chargeableAmount: chargeable ? rnd.pick([4500, 6500, 8500, 12000, 18500]) : null,
        chargeableNote: chargeable ? 'Visit charges + parts as per service rate card' : '',
        pausedMinutes: status === 'waiting_customer' ? 0 : rnd.chance(0.1) ? rnd.int(30, 600) : 0,
        pausedSince: status === 'waiting_customer' ? at(nowLocal, -rnd.int(2, 20)) : null,
        feedbackToken: `seed${id.replace(/\W/g, '').toLowerCase()}`,
        spottedLeadId: null,
        lastActivityAt: r,
      };
      if (status === 'reopened') {
        // Re-opened recently: clocks restart from the re-open time (BR-34).
        const reopenAt = `${addDays(today, -rnd.int(0, 1))}T${String(rnd.int(9, 12)).padStart(2, '0')}:00`;
        Object.assign(t, {
          responseDueAt: at(reopenAt, hr),
          arrivalDueAt: at(reopenAt, ha),
          resolutionDueAt: at(reopenAt, hs),
          respondedAt: t.assigneeId ? at(reopenAt, 0.5) : null,
          arrivedAt: null,
          resolvedAt: null,
          closedAt: null,
          rating: null,
          feedbackComment: 'Customer: problem came back after closure',
          slaBreached: false,
          escalationLevel: 0,
        });
      }
      tickets.push(t);
      if (machine) recentByMachineCat.set(key, t);
      if (a && t.assigneeId) {
        const visitDone = done || status === 'reopened';
        visits.push({
          ...ctx.base(Math.max(0, ageDays - 1)),
          id: ctx.nextId('serviceVisits', 'SV'),
          ticketId: id,
          engineerId: t.assigneeId,
          visitType: ticketType === 'remote_support' ? 'remote' : 'site',
          status: visitDone ? 'completed' : 'on_site',
          travelStartAt: at(a, -rnd.next() * 2),
          checkInAt: a,
          checkInLat: 21.17 + rnd.next() / 10,
          checkInLng: 72.83 + rnd.next() / 10,
          checkInMock: true,
          diagnosis: visitDone ? 'Found issue as reported; see work performed.' : 'Checking',
          workDone: visitDone ? s(t.resolution) : '',
          partsUsed: visitDone && rnd.chance(0.4) ? rnd.pick(['1 × damper kit', '1 × wiper blade', '1 × head board', 'Cap top set']) : '',
          photosBefore: visitDone ? 'before_1.jpg' : '',
          photosAfter: visitDone ? 'after_1.jpg' : '',
          printCounter: visitDone && machine ? rnd.int(2000, 90000) : null,
          inkUsedMl: visitDone && machine ? rnd.int(500, 12000) : null,
          checkOutAt: visitDone ? sres : null,
          signOffMethod: visitDone ? rnd.pick(['otp', 'signature']) : null,
          signedOffAt: visitDone ? sres : null,
        });
      }
    }
  }

  // ---------------------------------------------------------------- PM visits (created by installed): status by date, some done
  (R.pmVisits ?? []).forEach((p) => {
    const m = machines.find((x) => x.id === p.machineId);
    p.divisionId = p.divisionId ?? m?.divisionId ?? null;
    if (p.status === 'done') {
      p.completedAt = p.completedAt ?? p.dueDate;
      p.checklist = p.checklist ?? '✓ All checklist items OK';
      return;
    }
    const due = s(p.dueDate);
    if (due < today && rnd.chance(0.75)) {
      p.status = 'done';
      p.completedAt = addDays(due, rnd.int(-3, 5) > 0 ? rnd.int(0, 5) : 0);
      p.checklist = '✓ All checklist items OK';
    } else p.status = due < addDays(today, -30) ? 'missed' : due < today ? 'overdue' : 'due';
  });

  // ---------------------------------------------------------------- knowledge base
  const kb: RecordData[] = (R.knowledgeArticles ??= []);
  const authors = (R.employees ?? []).filter((e) => ['engineer', 'service_head'].includes(s(e.roleId)));
  KB.forEach(([title, models, errorCodes, category, symptoms, solution], i) => {
    const status = i >= KB.length - 3 ? (i === KB.length - 1 ? 'draft' : 'pending') : 'published';
    const authorId = authors.length ? rnd.pick(authors.filter((a) => a.roleId === 'engineer').length ? authors.filter((a) => a.roleId === 'engineer') : authors).id : null;
    const id = ctx.nextId('knowledgeArticles', 'KB');
    if (status === 'pending') {
      // Engineer contributions waiting for the service head (FR-090).
      ctx.counters.approvals = (ctx.counters.approvals ?? 1000) + 1;
      const requester = ctx.users.find((u) => u.staffIds.tc === authorId);
      ctx.approvals.push({
        id: `APR-${ctx.counters.approvals}`,
        type: 'kb.article',
        workspaceId: 'tc',
        resource: 'knowledgeArticles',
        recordId: id,
        requestedBy: requester?.id ?? 'u_ravi',
        requestedAt: new Date(now.getTime() - rnd.int(1, 5) * 86_400_000).toISOString(),
        reason: '',
        summary: `KB article “${title}”`,
        levels: [{ capability: 'approve.service', label: 'Service head' }],
        currentLevel: 0,
        decisions: [],
        status: 'pending',
        version: 1,
      });
    }
    kb.push({
      ...ctx.base(rnd.int(10, 300)),
      id,
      title,
      models,
      errorCodes,
      category,
      symptoms,
      solution,
      authorId,
      status,
    });
  });
}
