/** Foundation resources: the user directory (drives hierarchy and scopes), tasks and the activity log. Labels: L.common.resources. */
import type { ResourceDefinition } from '../../metadata/types';
import { L } from '../../constants/labels';
import { ALL, cols, cond, field, FORM_ONLY, group, views } from '../helpers';

const fe = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('employees', key, label, type, extra);
const U = L.common.resources.users;
const T = L.common.resources.tasks;
const A = L.common.resources.activities;

const ft = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('tasks', key, label, type, extra);

export const employees: ResourceDefinition = {
  id: 'res_employees',
  key: 'employees',
  module: 'admin',
  label: U.one,
  labelPlural: U.many,
  icon: 'users',
  version: 1,
  idPrefix: 'E',
  titleField: 'fullName',
  subtitleFields: ['designation', 'status'],
  divisionField: 'divisionIds',
  description: U.description,
  status: 'published',
  fields: [
    fe('fullName', U.fields.fullName, 'text', { required: true, maxLength: 80, capabilities: ALL, width: 200, subFields: ['designation'], leadingImage: 'initials', leadingShape: 'circle' }),
    fe('designation', U.fields.designation, 'text', { required: true, maxLength: 80, capabilities: ALL, width: 240 }),
    fe('roleId', U.fields.roleId, 'master', { master: 'role', required: true, width: 170 }),
    fe('divisionIds', U.fields.divisionIds, 'multimaster', { master: 'division', required: true, width: 200 }),
    fe('managerId', U.fields.managerId, 'relation', { relation: { resource: 'employees' }, width: 180, display: 'person', personSubtitle: 'designation' }),
    fe('territoryIds', U.fields.territoryIds, 'multimaster', { master: 'territory', width: 200 }),
    fe('email', U.fields.email, 'email', { required: true, format: 'email', sensitivity: 'contact', capabilities: ALL, width: 230 }),
    fe('mobile', U.fields.mobile, 'phone', { required: true, format: 'mobile', sensitivity: 'contact', capabilities: ALL, width: 140 }),
    fe('status', U.fields.status, 'master', { master: 'employeeStatus', required: true, defaultValue: 'active', width: 120 }),
    fe('joinedOn', U.fields.joinedOn, 'date', { dateRule: 'past' }),
  ],
  relationships: [
    { id: 'rel_emp_reports', label: U.relationships.reports, resource: 'employees', foreignKey: 'managerId' },
    { id: 'rel_emp_tasks', label: U.relationships.tasks, resource: 'tasks', foreignKey: 'assigneeId' },
  ],
  form: {
    quickCreate: ['fullName', 'designation', 'roleId', 'divisionIds', 'managerId', 'email', 'mobile'],
    sections: [
      { id: 'profile', title: U.sections.profile, fields: ['fullName', 'designation', 'roleId', 'status', 'joinedOn'], columns: 2 },
      { id: 'org', title: U.sections.org, fields: ['divisionIds', 'managerId', 'territoryIds'], columns: 2 },
      { id: 'contact', title: U.sections.contact, fields: ['email', 'mobile'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_emp_all',
      resource: 'employees',
      name: U.views.all,
      type: 'table',
      filter: group('and', [cond('status', 'neq', 'inactive')]),
      sort: [{ field: 'fullName', dir: 'asc' }],
      columns: cols('fullName', 'id', 'designation', 'roleId', 'divisionIds', 'managerId', 'mobile', 'email', 'status'),
    },
    {
      id: 'v_emp_team',
      resource: 'employees',
      name: U.views.team,
      type: 'table',
      filter: group('and', [cond('status', 'neq', 'inactive')]),
      sort: [{ field: 'fullName', dir: 'asc' }],
      rowLines: 2,
      columns: cols('fullName', 'managerId', 'roleId', 'divisionIds', 'territoryIds'),
    },
    {
      id: 'v_emp_by_role',
      resource: 'employees',
      name: U.views.byRole,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'fullName', dir: 'asc' }],
      groupBy: 'roleId',
      columns: cols('fullName', 'designation', 'divisionIds', 'managerId', 'status'),
    },
  ]),
};

export const tasks: ResourceDefinition = {
  id: 'res_tasks',
  key: 'tasks',
  module: 'home',
  label: T.one,
  labelPlural: T.many,
  icon: 'check-square',
  version: 1,
  idPrefix: 'T',
  titleField: 'title',
  subtitleFields: ['assigneeId', 'status'],
  ownerField: 'assigneeId',
  description: T.description,
  status: 'published',
  fields: [
    ft('title', T.fields.title, 'text', { required: true, maxLength: 120, capabilities: ALL, width: 300, subFields: ['dueDate', 'priority'] }),
    ft('taskType', T.fields.taskType, 'master', { master: 'taskType', required: true, defaultValue: 'follow_up', width: 120 }),
    ft('assigneeId', T.fields.assigneeId, 'relation', { relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, required: true, width: 180, display: 'person', personSubtitle: 'designation' }),
    ft('dueDate', T.fields.dueDate, 'date', { required: true, dateRule: 'future' }),
    ft('priority', T.fields.priority, 'master', { master: 'taskPriority', required: true, defaultValue: 'medium' }),
    ft('status', T.fields.status, 'master', { master: 'taskStatus', readOnly: true }),
    ft('relatedLabel', T.fields.relatedLabel, 'text', { readOnly: true, capabilities: { list: true, search: true } }),
    ft('description', T.fields.description, 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'todo',
    terminal: ['cancelled'],
    transitions: [
      { from: ['todo'], to: 'in_progress', action: T.actions.start },
      { from: ['todo', 'in_progress'], to: 'done', action: T.actions.complete },
      { from: ['todo', 'in_progress'], to: 'cancelled', action: T.actions.cancel, confirm: T.confirmCancel },
      { from: ['done'], to: 'todo', action: T.actions.reopen },
    ],
  },
  form: {
    quickCreate: ['title', 'taskType', 'assigneeId', 'dueDate', 'priority'],
    sections: [{ id: 'main', title: T.sections.main, fields: ['title', 'taskType', 'assigneeId', 'dueDate', 'priority', 'description'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_tasks_open',
      resource: 'tasks',
      name: T.views.open,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['todo', 'in_progress'])]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('title', 'taskType', 'assigneeId', 'dueDate', 'priority', 'status', 'relatedLabel'),
    },
    {
      id: 'v_tasks_overdue',
      resource: 'tasks',
      name: T.views.overdue,
      type: 'table',
      filter: group('and', [cond('status', 'in', ['todo', 'in_progress']), cond('dueDate', 'past')]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('title', 'taskType', 'assigneeId', 'dueDate', 'priority', 'status'),
    },
    {
      id: 'v_tasks_board',
      resource: 'tasks',
      name: T.views.board,
      type: 'board',
      boardField: 'status',
      filter: group('and'),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('title', 'assigneeId', 'dueDate', 'priority'),
    },
    {
      id: 'v_tasks_all',
      resource: 'tasks',
      name: T.views.all,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'dueDate', dir: 'desc' }],
      columns: cols('title', 'taskType', 'assigneeId', 'dueDate', 'priority', 'status', 'relatedLabel'),
    },
  ]),
};

const fa = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('activities', key, label, type, extra);

/**
 * Shared interaction log (COM-05 timelines, LEAD-09 follow-ups): calls, emails, WhatsApp,
 * meetings, visits and notes on any record. `parentResource` + `parentId` point at the record;
 * `customerId` lets the Customer 360 timeline collect everything for one company.
 */
export const activities: ResourceDefinition = {
  id: 'res_activities',
  key: 'activities',
  module: 'home',
  label: A.one,
  labelPlural: A.many,
  icon: 'message',
  version: 1,
  idPrefix: 'ACT',
  titleField: 'subject',
  subtitleFields: ['activityType', 'at'],
  ownerField: 'byId',
  description: A.description,
  status: 'published',
  fields: [
    fa('subject', A.fields.subject, 'text', { required: true, maxLength: 140, capabilities: ALL, width: 300, subFields: ['parentLabel'] }),
    fa('activityType', A.fields.activityType, 'master', { master: 'activityType', required: true, defaultValue: 'call', width: 110 }),
    fa('at', A.fields.at, 'datetime', { required: true, width: 150 }),
    fa('byId', A.fields.byId, 'relation', { relation: { resource: 'employees' }, required: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    // Link fields are set by logActivity(); they are not in any form section, so users never edit them.
    fa('parentLabel', A.fields.parentLabel, 'text', { capabilities: { list: true, search: true, sort: true }, width: 220 }),
    fa('nextFollowUpAt', A.fields.nextFollowUpAt, 'date', { dateRule: 'future' }),
    fa('notes', A.fields.notes, 'longtext', { maxLength: 2000, capabilities: { ...FORM_ONLY, search: true } }),
    fa('parentResource', A.fields.parentResource, 'text', { capabilities: { filter: true } }),
    fa('parentId', A.fields.parentId, 'text', { capabilities: { filter: true, search: true } }),
    fa('customerId', A.fields.customerId, 'text', { capabilities: { filter: true } }),
  ],
  relationships: [],
  form: {
    quickCreate: ['activityType', 'subject', 'at', 'byId', 'nextFollowUpAt', 'notes'],
    sections: [{ id: 'main', title: A.sections.main, fields: ['activityType', 'subject', 'at', 'byId', 'nextFollowUpAt', 'notes'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_act_recent',
      resource: 'activities',
      name: A.views.recent,
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'at', dir: 'desc' }],
      columns: cols('at', 'activityType', 'subject', 'parentLabel', 'byId', 'nextFollowUpAt'),
    },
    {
      id: 'v_act_followups',
      resource: 'activities',
      name: A.views.followUps,
      type: 'table',
      filter: group('and', [cond('nextFollowUpAt', 'notEmpty')]),
      sort: [{ field: 'nextFollowUpAt', dir: 'asc' }],
      columns: cols('nextFollowUpAt', 'subject', 'parentLabel', 'byId', 'activityType'),
    },
  ]),
};
