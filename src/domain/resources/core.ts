/** Foundation resources: the employee directory (drives hierarchy and scopes) and tasks. */
import type { ResourceDefinition } from '../../metadata/types';
import { ALL, cols, cond, field, FORM_ONLY, group, views } from '../helpers';

const fe = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('employees', key, label, type, extra);
const ft = (key: string, label: string, type: Parameters<typeof field>[3], extra?: Parameters<typeof field>[4]) => field('tasks', key, label, type, extra);

export const employees: ResourceDefinition = {
  id: 'res_employees',
  key: 'employees',
  module: 'admin',
  label: 'Employee',
  labelPlural: 'Employees',
  icon: 'users',
  version: 1,
  idPrefix: 'E',
  titleField: 'fullName',
  subtitleFields: ['designation', 'status'],
  divisionField: 'divisionIds',
  description: 'Everyone who uses the CRM. Reporting manager and divisions decide who sees which records.',
  status: 'published',
  fields: [
    fe('fullName', 'Full name', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 200, subFields: ['designation'], leadingImage: 'initials' }),
    fe('designation', 'Designation', 'text', { required: true, maxLength: 80, capabilities: ALL, width: 240 }),
    fe('roleId', 'CRM role', 'master', { master: 'role', required: true, width: 170 }),
    fe('divisionIds', 'Divisions', 'multimaster', { master: 'division', required: true, width: 200 }),
    fe('managerId', 'Reports to', 'relation', { relation: { resource: 'employees' }, width: 180, display: 'person', personSubtitle: 'designation' }),
    fe('territoryIds', 'Territories', 'multimaster', { master: 'territory', width: 200 }),
    fe('email', 'Work email', 'email', { required: true, format: 'email', sensitivity: 'contact', capabilities: ALL, width: 230 }),
    fe('mobile', 'Mobile', 'phone', { required: true, format: 'mobile', sensitivity: 'contact', capabilities: ALL, width: 140 }),
    fe('status', 'Status', 'master', { master: 'employeeStatus', required: true, defaultValue: 'active', width: 120 }),
    fe('joinedOn', 'Joined on', 'date', { dateRule: 'past' }),
  ],
  relationships: [
    { id: 'rel_emp_reports', label: 'Direct reports', resource: 'employees', foreignKey: 'managerId' },
    { id: 'rel_emp_tasks', label: 'Tasks', resource: 'tasks', foreignKey: 'assigneeId' },
  ],
  form: {
    quickCreate: ['fullName', 'designation', 'roleId', 'divisionIds', 'managerId', 'email', 'mobile'],
    sections: [
      { id: 'profile', title: 'Profile', fields: ['fullName', 'designation', 'roleId', 'status', 'joinedOn'], columns: 2 },
      { id: 'org', title: 'Organisation', fields: ['divisionIds', 'managerId', 'territoryIds'], columns: 2 },
      { id: 'contact', title: 'Contact', fields: ['email', 'mobile'], columns: 2 },
    ],
  },
  views: views([
    {
      id: 'v_emp_all',
      resource: 'employees',
      name: 'All employees',
      type: 'table',
      filter: group('and', [cond('status', 'neq', 'inactive')]),
      sort: [{ field: 'fullName', dir: 'asc' }],
      columns: cols('fullName', 'id', 'designation', 'roleId', 'divisionIds', 'managerId', 'mobile', 'email', 'status'),
    },
    {
      id: 'v_emp_team',
      resource: 'employees',
      name: 'Team view',
      type: 'table',
      filter: group('and', [cond('status', 'neq', 'inactive')]),
      sort: [{ field: 'fullName', dir: 'asc' }],
      rowLines: 2,
      columns: cols('fullName', 'managerId', 'roleId', 'divisionIds', 'territoryIds'),
    },
    {
      id: 'v_emp_by_role',
      resource: 'employees',
      name: 'By role',
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
  label: 'Task',
  labelPlural: 'Tasks',
  icon: 'check-square',
  version: 1,
  idPrefix: 'T',
  titleField: 'title',
  subtitleFields: ['assigneeId', 'status'],
  ownerField: 'assigneeId',
  description: 'Calls, meetings, visits, demos and follow-ups. Completing a task never approves a request.',
  status: 'published',
  fields: [
    ft('title', 'Title', 'text', { required: true, maxLength: 120, capabilities: ALL, width: 300, subFields: ['dueDate', 'priority'] }),
    ft('taskType', 'Type', 'master', { master: 'taskType', required: true, defaultValue: 'follow_up', width: 120 }),
    ft('assigneeId', 'Assignee', 'relation', { relation: { resource: 'employees', where: { field: 'status', op: 'neq', value: 'inactive' } }, required: true, width: 180, display: 'person', personSubtitle: 'designation' }),
    ft('dueDate', 'Due', 'date', { required: true, dateRule: 'future' }),
    ft('priority', 'Priority', 'master', { master: 'taskPriority', required: true, defaultValue: 'medium' }),
    ft('status', 'Status', 'master', { master: 'taskStatus', readOnly: true }),
    ft('relatedLabel', 'Related to', 'text', { readOnly: true, capabilities: { list: true, search: true } }),
    ft('description', 'Notes', 'longtext', { maxLength: 2000, capabilities: FORM_ONLY }),
  ],
  relationships: [],
  lifecycle: {
    field: 'status',
    initial: 'todo',
    terminal: ['cancelled'],
    transitions: [
      { from: ['todo'], to: 'in_progress', action: 'Start' },
      { from: ['todo', 'in_progress'], to: 'done', action: 'Complete' },
      { from: ['todo', 'in_progress'], to: 'cancelled', action: 'Cancel task', confirm: 'Cancel this task? It stays in the list as cancelled.' },
      { from: ['done'], to: 'todo', action: 'Reopen' },
    ],
  },
  form: {
    quickCreate: ['title', 'taskType', 'assigneeId', 'dueDate', 'priority'],
    sections: [{ id: 'main', title: 'Task', fields: ['title', 'taskType', 'assigneeId', 'dueDate', 'priority', 'description'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_tasks_open',
      resource: 'tasks',
      name: 'Open',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['todo', 'in_progress'])]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('title', 'taskType', 'assigneeId', 'dueDate', 'priority', 'status', 'relatedLabel'),
    },
    {
      id: 'v_tasks_overdue',
      resource: 'tasks',
      name: 'Overdue',
      type: 'table',
      filter: group('and', [cond('status', 'in', ['todo', 'in_progress']), cond('dueDate', 'past')]),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('title', 'taskType', 'assigneeId', 'dueDate', 'priority', 'status'),
    },
    {
      id: 'v_tasks_board',
      resource: 'tasks',
      name: 'Board',
      type: 'board',
      boardField: 'status',
      filter: group('and'),
      sort: [{ field: 'dueDate', dir: 'asc' }],
      columns: cols('title', 'assigneeId', 'dueDate', 'priority'),
    },
    {
      id: 'v_tasks_all',
      resource: 'tasks',
      name: 'All',
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
  label: 'Activity',
  labelPlural: 'Activities',
  icon: 'message',
  version: 1,
  idPrefix: 'ACT',
  titleField: 'subject',
  subtitleFields: ['activityType', 'at'],
  ownerField: 'byId',
  description: 'Calls, emails, WhatsApp messages, meetings, visits and notes logged against customers, leads, opportunities and tickets.',
  status: 'published',
  fields: [
    fa('subject', 'Subject', 'text', { required: true, maxLength: 140, capabilities: ALL, width: 300, subFields: ['parentLabel'] }),
    fa('activityType', 'Type', 'master', { master: 'activityType', required: true, defaultValue: 'call', width: 110 }),
    fa('at', 'When', 'datetime', { required: true, width: 150 }),
    fa('byId', 'Logged by', 'relation', { relation: { resource: 'employees' }, required: true, width: 170, display: 'person', personSubtitle: 'designation' }),
    // Link fields are set by logActivity(); they are not in any form section, so users never edit them.
    fa('parentLabel', 'Related to', 'text', { capabilities: { list: true, search: true, sort: true }, width: 220 }),
    fa('nextFollowUpAt', 'Next follow-up', 'date', { dateRule: 'future' }),
    fa('notes', 'Notes', 'longtext', { maxLength: 2000, capabilities: { ...FORM_ONLY, search: true } }),
    fa('parentResource', 'Record type', 'text', { capabilities: { filter: true } }),
    fa('parentId', 'Record', 'text', { capabilities: { filter: true, search: true } }),
    fa('customerId', 'Customer id', 'text', { capabilities: { filter: true } }),
  ],
  relationships: [],
  form: {
    quickCreate: ['activityType', 'subject', 'at', 'byId', 'nextFollowUpAt', 'notes'],
    sections: [{ id: 'main', title: 'Activity', fields: ['activityType', 'subject', 'at', 'byId', 'nextFollowUpAt', 'notes'], columns: 2 }],
  },
  views: views([
    {
      id: 'v_act_recent',
      resource: 'activities',
      name: 'Recent',
      type: 'table',
      filter: group('and'),
      sort: [{ field: 'at', dir: 'desc' }],
      columns: cols('at', 'activityType', 'subject', 'parentLabel', 'byId', 'nextFollowUpAt'),
    },
    {
      id: 'v_act_followups',
      resource: 'activities',
      name: 'Follow-ups due',
      type: 'table',
      filter: group('and', [cond('nextFollowUpAt', 'notEmpty')]),
      sort: [{ field: 'nextFollowUpAt', dir: 'asc' }],
      columns: cols('nextFollowUpAt', 'subject', 'parentLabel', 'byId', 'activityType'),
    },
  ]),
};
