/**
 * Deterministic, referentially valid SYNTHETIC data. All names, phones (555-01xx
 * fictional range) and emails (example.com/.org/.net) are invented. Dates are generated
 * relative to the day the dataset is first seeded so the demo always has
 * past, today and upcoming work.
 */
import type { RecordData } from '../../metadata/types';
import { addDays, addMinutes, parseLocal, toDateKey, toLocalDateTime } from '../../lib/dates';
import { prng } from '../../lib/ids';
import type { Approval, AppNotification, Comment } from '../../services/types';
import { demoUsers, workspaces } from './pack';

const FIRST = [
  'Avery', 'Blake', 'Camila', 'Dmitri', 'Elena', 'Farah', 'Gabriel', 'Hana', 'Idris', 'Jun', 'Kiara', 'Leon', 'Maya', 'Nikhil',
  'Olivia', 'Pablo', 'Quinn', 'Rosa', 'Soren', 'Tariq', 'Uma', 'Victor', 'Wen', 'Ximena', 'Yusuf', 'Zara', 'Mateo', 'Ingrid',
  'Kwame', 'Leila', 'Noah', 'Priya', 'Rafael', 'Sakura', 'Tomas', 'Amira',
];
const LAST = [
  'Abernathy', 'Bakshi', 'Castellano', 'Dubois', 'Eriksen', 'Fontaine', 'Garrido', 'Haddad', 'Ibarra', 'Jansen', 'Kowalski',
  'Lindqvist', 'Mbeki', 'Nakamura', 'Okafor', 'Petrov', 'Quintero', 'Rahman', 'Sandoval', 'Takahashi', 'Ueda', 'Valdez',
  'Whitaker', 'Yilmaz', 'Zhang', 'Moreau', 'Asante', 'Brennan',
];

const STAFF_EXTRA = [
  { name: 'Dr. Lucas Brennan', role: 'physician', dept: 'family_medicine' },
  { name: 'Dr. Mei Tanaka', role: 'physician', dept: 'pediatrics' },
  { name: 'Rhea Kapoor', role: 'nurse_practitioner', dept: 'dermatology' },
  { name: 'Theo Lindqvist', role: 'physiotherapist', dept: 'physiotherapy' },
  { name: 'Ana Sousa', role: 'nurse', dept: 'family_medicine' },
  { name: 'Felix Grant', role: 'front_desk', dept: 'operations' },
  { name: 'Noor Haddad', role: 'nurse', dept: 'pediatrics' },
];

const ROOMS = [
  { name: 'Consult 1', type: 'consult', floor: '1' },
  { name: 'Consult 2', type: 'consult', floor: '1' },
  { name: 'Consult 3', type: 'consult', floor: '2' },
  { name: 'Procedure A', type: 'procedure', floor: '1' },
  { name: 'Treatment B', type: 'treatment', floor: '2' },
  { name: 'Consult 4', type: 'consult', floor: '2', status: 'maintenance' },
  { name: 'Telehealth booth', type: 'telehealth', floor: '1' },
];

const REASONS = ['Routine follow-up requested', 'Annual review due', 'Form completion visit', 'Medication review appointment', 'Pre-travel check', 'Results discussion booked'];
const ORGS = ['Lakeside Specialty Group', 'Summit Imaging Center', 'Harborview Orthopedics', 'Meadow Heart Associates', 'Cedar Skin Clinic'];
const TASKS = [
  'Call back about rescheduling',
  'Confirm next week’s bookings',
  'Restock front desk forms',
  'Verify coverage details',
  'Chase unsigned registration form',
  'Update room equipment notes',
  'Follow up on unpaid balance',
  'Send referral packet (manual)',
  'Review no-show list',
  'Prepare monthly room utilization summary',
];

export interface SeedResult {
  records: Record<string, RecordData[]>;
  counters: Record<string, number>;
  comments: Comment[];
  approvals: Approval[];
  notifications: AppNotification[];
}

export function seedClinic(seed: number, now = new Date()): SeedResult {
  const r = prng(seed);
  const today = toDateKey(now);
  const nowStamp = now.toISOString();
  const records: Record<string, RecordData[]> = { patients: [], appointments: [], staff: [], rooms: [], invoices: [], referrals: [], tasks: [] };
  const counters: Record<string, number> = {};
  const comments: Comment[] = [];
  const approvals: Approval[] = [];
  const notifications: AppNotification[] = [];

  const base = (id: string, workspaceId: string, extra: Record<string, unknown>): RecordData => ({
    id,
    workspaceId,
    version: 1,
    createdAt: nowStamp,
    updatedAt: nowStamp,
    createdBy: 'system_seed',
    ...extra,
  });

  workspaces.forEach((ws, wi) => {
    const n0 = (wi + 1) * 1000;

    // --- Staff (first four are the demo users' linked records)
    const staffIds: string[] = [];
    const staffList = [
      ...demoUsers.map((u) => ({
        name: u.name,
        role: u.roleId === 'practice_manager' ? 'practice_manager' : u.roleId === 'front_desk' ? 'front_desk' : u.roleId === 'clinician' ? 'physician' : 'billing',
        dept: u.roleId === 'clinician' ? 'family_medicine' : 'operations',
      })),
      ...STAFF_EXTRA,
    ];
    /** Illustrative portrait (generated SVG silhouette, no real photo) — some staff have none, to show the initials fallback. */
    const portrait = (seed: number) => {
      const hue = (seed * 47) % 360;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue},45%,86%)"/><circle cx="32" cy="25" r="12" fill="hsl(${hue},30%,52%)"/><path d="M10 64c2-14 11-21 22-21s20 7 22 21z" fill="hsl(${hue},30%,42%)"/></svg>`;
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    };
    staffList.forEach((s, i) => {
      const id = `S-${n0 + i + 1}`;
      staffIds.push(id);
      const slug = s.name.replace('Dr. ', '').toLowerCase().replace(/[^a-z]+/g, '.');
      records.staff.push(
        base(id, ws.id, {
          fullName: s.name,
          photo: i % 4 === 3 ? null : portrait(i + wi * 5),
          staffRole: s.role,
          department: s.dept,
          status: i === 9 ? 'on_leave' : 'active',
          workingDays: i % 3 === 0 ? ['mon', 'tue', 'wed', 'thu', 'fri'] : i % 3 === 1 ? ['mon', 'wed', 'thu', 'fri'] : ['tue', 'wed', 'thu', 'fri', 'sat'],
          email: `${slug}@${ws.slug}.example.org`,
          phone: `+1 555-01${String(10 + i).padStart(2, '0')}-${String(r.int(1000, 9999))}`,
          weeklyCapacity: ['physician', 'nurse_practitioner', 'physiotherapist'].includes(s.role) ? 60 : 0,
        }),
      );
    });
    counters.staff = Math.max(counters.staff ?? 0, n0 + staffList.length);
    const clinicians = records.staff.filter(
      (s) => s.workspaceId === ws.id && ['physician', 'nurse_practitioner', 'physiotherapist'].includes(String(s.staffRole)) && s.status === 'active',
    );

    // --- Rooms
    const roomIds: string[] = [];
    ROOMS.forEach((rm, i) => {
      const id = `R-${n0 + i + 1}`;
      roomIds.push(id);
      records.rooms.push(
        base(id, ws.id, {
          name: rm.name,
          roomType: rm.type,
          floor: rm.floor,
          capacity: rm.type === 'procedure' ? 4 : 2,
          status: rm.status ?? 'available',
          equipment: rm.type === 'procedure' ? 'Adjustable table, procedure light' : rm.type === 'telehealth' ? 'Camera, headset' : 'Exam table, desk',
        }),
      );
    });
    counters.rooms = Math.max(counters.rooms ?? 0, n0 + ROOMS.length);
    const bookableRooms = roomIds.slice(0, 5);

    // --- Patients
    const patientIds: string[] = [];
    for (let i = 0; i < 48; i++) {
      const id = `P-${n0 + i + 1}`;
      patientIds.push(id);
      const first = r.pick(FIRST);
      const last = r.pick(LAST);
      const payer = r.pick(['self_pay', 'northstar', 'meridian', 'civic', 'northstar']);
      const age = r.int(1, 88);
      const dob = toDateKey(new Date(now.getFullYear() - age, r.int(0, 11), r.int(1, 28)));
      records.patients.push(
        base(id, ws.id, {
          fullName: `${first} ${last}`,
          preferredName: r.chance(0.2) ? first.slice(0, 3) : '',
          dateOfBirth: dob,
          phone: `+1 555-01${String(r.int(0, 99)).padStart(2, '0')}-${String(r.int(1000, 9999))}`,
          email: r.chance(0.8) ? `${first}.${last}${r.int(1, 99)}@example.com`.toLowerCase() : '',
          contactPreference: r.pick(['phone', 'email', 'sms']),
          status: i < 6 ? 'new' : r.chance(0.88) ? 'active' : 'inactive',
          primaryClinicianId: r.pick(clinicians).id,
          payer,
          memberId: payer === 'self_pay' ? '' : `${payer.slice(0, 2).toUpperCase()}${r.int(10000000, 99999999)}`,
          accessNeeds: r.chance(0.15) ? [r.pick(['interpreter', 'wheelchair', 'large_print', 'hearing_loop'])] : [],
          restrictedNote: r.chance(0.2) ? 'Prefers morning appointments; caregiver attends.' : '',
          registeredOn: addDays(today, -r.int(0, 700)),
        }),
      );
    }
    counters.patients = Math.max(counters.patients ?? 0, n0 + 48);

    // --- Appointments: each clinician keeps a dedicated room so seeds never overlap
    let apptN = n0 + 1;
    const nowLocal = toLocalDateTime(now);
    const apptIds: string[] = [];
    for (let d = -14; d <= 10; d++) {
      const day = addDays(today, d);
      const dow = parseLocal(day).getDay();
      if (dow === 0) continue;
      clinicians.forEach((c, ci) => {
        const count = dow === 6 ? r.int(0, 2) : r.int(2, 5);
        let cursor = `${day}T${String(8 + (ci % 2)).padStart(2, '0')}:${ci % 2 ? '00' : '30'}`;
        for (let k = 0; k < count; k++) {
          const duration = r.pick([15, 30, 30, 45, 60]);
          const tele = r.chance(0.12);
          const start = cursor;
          const end = addMinutes(start, duration);
          cursor = addMinutes(end, r.pick([0, 15, 30, 45]));
          let status: string;
          if (end <= nowLocal) status = r.chance(0.8) ? 'completed' : r.chance(0.5) ? 'no_show' : 'cancelled';
          else if (start <= nowLocal) status = 'in_progress';
          else if (day === today) status = r.chance(0.3) ? 'checked_in' : r.chance(0.6) ? 'confirmed' : 'scheduled';
          else status = r.chance(0.1) ? 'cancelled' : r.chance(0.5) ? 'confirmed' : 'scheduled';
          if (day === today && status === 'checked_in' && start > addMinutes(nowLocal, 60)) status = 'confirmed';
          const id = `A-${apptN++}`;
          apptIds.push(id);
          const type = tele ? 'telehealth_check' : r.pick(['new_patient', 'follow_up', 'follow_up', 'annual_review', 'procedure_slot']);
          records.appointments.push(
            base(id, ws.id, {
              patientId: r.pick(patientIds),
              clinicianId: c.id,
              start,
              durationMin: duration,
              visitMode: tele ? 'telehealth' : 'in_person',
              roomId: tele ? null : bookableRooms[ci % bookableRooms.length],
              appointmentType: type,
              status,
              bookingChannel: r.pick(['phone', 'phone', 'front_desk', 'walk_in', 'referral']),
              visitReason: r.pick(REASONS),
              expectedCopay: r.pick([0, 15, 25, 25, 40]),
            }),
          );
        }
      });
    }
    counters.appointments = Math.max(counters.appointments ?? 0, apptN);

    // --- Invoices: from completed visits plus older balances
    let invN = n0 + 1;
    const completed = records.appointments.filter((a) => a.workspaceId === ws.id && a.status === 'completed');
    completed.forEach((a) => {
      if (!r.chance(0.55)) return;
      const issue = String(a.start).slice(0, 10);
      const price = a.appointmentType === 'procedure_slot' ? 180 : a.appointmentType === 'new_patient' ? 140 : a.appointmentType === 'telehealth_check' ? 60 : 95;
      const lineItems = [
        {
          serviceCode: a.appointmentType === 'procedure_slot' ? 'procedure_minor' : a.appointmentType === 'telehealth_check' ? 'telehealth' : a.appointmentType === 'follow_up' ? 'follow_up' : 'consult_std',
          description: 'Visit charge',
          qty: 1,
          unitPrice: price,
        },
        ...(r.chance(0.3) ? [{ serviceCode: 'admin_fee', description: 'Forms processing', qty: 1, unitPrice: 20 }] : []),
      ];
      const total = lineItems.reduce((s, li) => s + li.qty * li.unitPrice, 0);
      const roll = r.next();
      const status = roll < 0.45 ? 'paid' : roll < 0.6 ? 'partially_paid' : roll < 0.92 ? 'issued' : 'draft';
      const patient = records.patients.find((p) => p.id === a.patientId);
      records.invoices.push(
        base(`INV-${invN++}`, ws.id, {
          patientId: a.patientId,
          appointmentId: a.id,
          payer: patient?.payer ?? 'self_pay',
          issueDate: issue,
          dueDate: addDays(issue, 14),
          lineItems,
          amountPaid: status === 'paid' ? total : status === 'partially_paid' ? Math.round(total * 0.4) : 0,
          status,
          notes: '',
        }),
      );
    });
    for (let i = 0; i < 8; i++) {
      const issue = addDays(today, -r.int(30, 75));
      const total = r.pick([95, 140, 180, 240]);
      const status = i < 6 ? 'issued' : 'partially_paid';
      records.invoices.push(
        base(`INV-${invN++}`, ws.id, {
          patientId: r.pick(patientIds),
          appointmentId: null,
          payer: 'self_pay',
          issueDate: issue,
          dueDate: addDays(issue, 14),
          lineItems: [{ serviceCode: 'consult_std', description: 'Visit charge', qty: 1, unitPrice: total }],
          amountPaid: status === 'partially_paid' ? Math.round(total / 3) : 0,
          status,
          notes: 'Reminder letters sent (recorded manually).',
        }),
      );
    }
    counters.invoices = Math.max(counters.invoices ?? 0, invN);

    // --- Referrals
    const services: Record<string, string[]> = {
      cardiology: ['cardio_consult', 'stress_test'],
      orthopedics: ['ortho_consult', 'sports_clinic'],
      dermatology: ['derm_consult'],
      imaging: ['xray', 'ultrasound'],
    };
    for (let i = 0; i < 20; i++) {
      const specialty = r.pick(Object.keys(services));
      records.referrals.push(
        base(`RF-${n0 + i + 1}`, ws.id, {
          patientId: r.pick(patientIds),
          specialty,
          service: r.pick(services[specialty]),
          urgency: r.pick(['routine', 'routine', 'soon', 'urgent']),
          status: r.pick(['received', 'received', 'in_review', 'scheduled', 'closed', 'declined']),
          referredTo: r.pick(ORGS),
          assigneeId: r.pick([staffIds[1], staffIds[9]]),
          dueBy: addDays(today, r.int(-4, 14)),
          notes: 'Referral letter on file (synthetic).',
        }),
      );
    }
    counters.referrals = Math.max(counters.referrals ?? 0, n0 + 20);

    // --- Tasks
    /** Illustrative task picture (generated SVG of a document/photo card, no real image) — some tasks have none. */
    const taskPicture = (seed: number) => {
      const hue = (seed * 61 + 20) % 360;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue},55%,90%)"/><rect x="14" y="10" width="36" height="44" rx="4" fill="#fff"/><rect x="20" y="18" width="24" height="12" rx="2" fill="hsl(${hue},45%,70%)"/><rect x="20" y="35" width="24" height="3" rx="1.5" fill="hsl(${hue},20%,75%)"/><rect x="20" y="41" width="16" height="3" rx="1.5" fill="hsl(${hue},20%,75%)"/></svg>`;
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    };
    const taskIds: string[] = [];
    for (let i = 0; i < 14; i++) {
      const id = `T-${n0 + i + 1}`;
      taskIds.push(id);
      records.tasks.push(
        base(id, ws.id, {
          title: TASKS[i % TASKS.length],
          assigneeId: r.pick(staffIds.slice(0, 4)),
          collaboratorIds: staffIds.filter(() => r.next() < 0.35).slice(0, 1 + (i % 6)),
          cover: i % 5 === 4 ? null : taskPicture(i + wi * 7),
          dueDate: addDays(today, r.int(-3, 7)),
          priority: r.pick(['low', 'normal', 'normal', 'high', 'urgent']),
          status: r.pick(['todo', 'todo', 'in_progress', 'blocked', 'done']),
          relatedLabel: '',
          description: '',
        }),
      );
    }

    // --- Pending write-off approval (Workflow Runtime) + linked review task (Work Service)
    const openInv = records.invoices.find((x) => x.workspaceId === ws.id && x.status === 'issued' && String(x.dueDate) < today);
    if (openInv) {
      const taskId = `T-${n0 + 15}`;
      const total = (openInv.lineItems as { qty: number; unitPrice: number }[]).reduce((s, li) => s + li.qty * li.unitPrice, 0);
      const approvalId = `APR-${n0 + 1}`;
      approvals.push({
        id: approvalId,
        type: 'invoice.writeoff',
        workspaceId: ws.id,
        resource: 'invoices',
        recordId: openInv.id,
        requestedBy: 'u_sam',
        requestedAt: nowStamp,
        reason: 'Balance uncollectable after three reminders (synthetic example).',
        amount: total - Number(openInv.amountPaid || 0),
        status: 'pending',
        taskId,
        version: 1,
      });
      records.tasks.push(
        base(taskId, ws.id, {
          title: `Review write-off request for ${openInv.id}`,
          assigneeId: staffIds[0],
          dueDate: addDays(today, 2),
          priority: 'high',
          status: 'todo',
          relatedLabel: `${approvalId} · ${openInv.id}`,
          description: 'Completing this task does NOT approve the write-off. Decide in Work inbox → Approvals.',
        }),
      );
      notifications.push({
        id: `N-${ws.id}-apr`,
        userId: 'u_morgan',
        workspaceId: ws.id,
        kind: 'approval_request',
        title: `Write-off approval requested for ${openInv.id}`,
        link: { page: 'inbox' },
        createdAt: nowStamp,
      });
    }
    counters.tasks = Math.max(counters.tasks ?? 0, n0 + 16);
    counters.approvals = Math.max(counters.approvals ?? 0, n0 + 2);

    // --- Comments & notifications
    const someAppt = records.appointments.find((a) => a.workspaceId === ws.id && String(a.start).startsWith(today));
    if (someAppt) {
      comments.push({
        id: `C-${ws.id}-1`,
        workspaceId: ws.id,
        resource: 'appointments',
        recordId: someAppt.id,
        body: 'Patient called — may arrive 10 minutes late. @Jordan Reyes please hold the room.',
        authorId: 'u_morgan',
        createdAt: nowStamp,
        mentions: ['u_jordan'],
        visibility: 'internal',
      });
      notifications.push({
        id: `N-${ws.id}-m1`,
        userId: 'u_jordan',
        workspaceId: ws.id,
        kind: 'mention',
        title: `Morgan Ellis mentioned you on ${someAppt.id}`,
        link: { resource: 'appointments', recordId: someAppt.id },
        createdAt: nowStamp,
      });
    }
    comments.push({
      id: `C-${ws.id}-2`,
      workspaceId: ws.id,
      resource: 'patients',
      recordId: patientIds[0],
      body: 'Registration form received at front desk; coverage card scanned (synthetic note).',
      authorId: 'u_jordan',
      createdAt: nowStamp,
      mentions: [],
      visibility: 'internal',
    });
    const amaraTask = taskIds[0];
    notifications.push({
      id: `N-${ws.id}-t1`,
      userId: 'u_amara',
      workspaceId: ws.id,
      kind: 'reminder',
      title: 'You have appointments today — open Day schedule',
      link: { page: 'schedule' },
      createdAt: nowStamp,
    });
    notifications.push({
      id: `N-${ws.id}-t2`,
      userId: 'u_sam',
      workspaceId: ws.id,
      kind: 'assignment',
      title: `Task ${amaraTask} needs attention`,
      link: { resource: 'tasks', recordId: amaraTask },
      createdAt: nowStamp,
    });
  });

  return { records, counters, comments, approvals, notifications };
}
