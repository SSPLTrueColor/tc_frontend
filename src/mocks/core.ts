/** Core demo data: employees (from demo users), tasks and welcome notifications. */
import { addDays } from '../lib/dates';
import type { RecordData } from '../metadata/types';
import type { SeedContext } from './context';

const TASK_TEMPLATES: [string, string][] = [
  ['Call back about RIP software upgrade', 'call'],
  ['Visit site to check printer installation readiness', 'visit'],
  ['Follow up on pending sample print feedback', 'follow_up'],
  ['Prepare demo for sublimation printer', 'demo'],
  ['Weekly review with division head', 'meeting'],
  ['Confirm ink reorder quantity with customer', 'call'],
  ['Share revised brochure for label press', 'follow_up'],
  ['Plan beat for next week', 'other'],
  ['Collect PO copy from customer', 'follow_up'],
  ['Coordinate engineer visit for print-head issue', 'call'],
  ['Check paper stock requirement for next month', 'call'],
  ['Exhibition lead follow-up (Gartex)', 'follow_up'],
  ['Training session for new operator', 'meeting'],
  ['Update AMC renewal discussion notes', 'other'],
];

const CUSTOMERS = ['Shree Ganesh Prints', 'Om Sai Textiles', 'Arvind Digital Fabrics', 'Kaveri Label Works', 'Mahalaxmi Paper Mart', 'Sundaram Fashions', 'Royal Tex Processors', 'Nirmal Print Bureau'];

export function seedCore(ctx: SeedContext): void {
  const { rnd, today, users: demoUsers } = ctx;
  const WS = ctx.ws;
  const base = ctx.base(120);
  const createdAt = base.createdAt;
  const staffOf = (userId?: string) => (userId ? ctx.staff(userId) : null) || null;

  const employees: RecordData[] = demoUsers.map((u, i) => {
    const first = u.name.split(' ')[0].toLowerCase();
    return {
      ...base,
      id: u.staffIds[WS],
      fullName: u.name,
      designation: u.title,
      roleId: u.roleId,
      divisionIds: u.divisions,
      managerId: staffOf(u.managerId),
      territoryIds: u.territories,
      email: `${first}.${u.name.split(' ')[1].toLowerCase()}@truecolors.example`,
      mobile: `98${String(20000000 + i * 371137).slice(0, 8)}`,
      status: 'active',
      joinedOn: addDays(today, -rnd.int(200, 3200)),
    };
  });

  // Tasks for people who do field or desk follow-ups.
  const doers = demoUsers.filter((u) => ['sales_manager', 'sales_exec', 'engineer', 'coordinator', 'service_head', 'division_head'].includes(u.roleId));
  const tasks: RecordData[] = [];
  let n = 1000;
  for (const u of doers) {
    const count = rnd.int(3, 6);
    for (let k = 0; k < count; k++) {
      const [title, type] = rnd.pick(TASK_TEMPLATES);
      const offset = rnd.int(-6, 12);
      const status = offset < -3 ? rnd.pick(['done', 'done', 'todo']) : offset < 0 ? rnd.pick(['todo', 'in_progress', 'done']) : rnd.pick(['todo', 'todo', 'in_progress']);
      tasks.push({
        ...base,
        id: `T-${++n}`,
        title,
        taskType: type,
        assigneeId: u.staffIds[WS],
        dueDate: addDays(today, offset),
        priority: rnd.pick(['low', 'medium', 'medium', 'high', 'urgent']),
        status,
        relatedLabel: rnd.chance(0.7) ? rnd.pick(CUSTOMERS) : '',
        description: '',
      });
    }
  }

  const notifications = demoUsers
    .filter((u) => u.roleId !== 'admin')
    .map((u, i) => ({
      id: `ntf_seed_${i}`,
      userId: u.id,
      workspaceId: WS,
      kind: 'info' as const,
      title: 'Welcome to the True Colors CRM prototype — all data here is fictional',
      link: { page: 'dashboard' },
      createdAt,
    }));

  ctx.records.employees = employees;
  ctx.records.tasks = tasks;
  ctx.counters.employees = 1000 + employees.length;
  ctx.counters.tasks = n;
  ctx.notifications.push(...notifications);
}
