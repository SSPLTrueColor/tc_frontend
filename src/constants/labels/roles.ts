/** Role names (docs/GLOSSARY.md §4: Appendix B + System Administrator). The switcher shows "Role — Position". */
export const roles = {
  admin: { label: 'System Administrator', description: 'CRM admin (IT/MIS): full access, users, masters, workflows and configuration.' },
  management: { label: 'Management', description: 'MD, Chairman, CFO & Director: company-wide visibility and final approvals.' },
  division_head: { label: 'Division Head', description: 'GM / VP / Head of a division: everything in their division, level-2 approvals.' },
  sales_manager: { label: 'Sales Manager', description: 'Regional / national sales managers: own and team records, level-1 approvals.' },
  sales_exec: { label: 'Sales Executive', description: 'Ink, Paper, Fabric and Textile sales: own records only.' },
  service_head: { label: 'Service Leadership', description: 'Service Head, National Service Manager: all service work, service approvals and escalations.' },
  engineer: { label: 'Service Engineer', description: 'Field engineers: assigned jobs, own attendance and visits.' },
  coordinator: { label: 'Coordinator', description: 'Service / sales / fabric coordinators: division records, ticket logging and assignment.' },
  scm: { label: 'Import / SCM', description: 'Import Head and SCM executives: order processing, shipments and spares import.' },
  store: { label: 'Store In-charge', description: 'Main store: spares issue, receipts and returns.' },
  accounts: { label: 'Accounts', description: 'Finance checks on orders, expenses and collections; sees margins.' },
  profiling: { label: 'Profiling Manager', description: 'Profiling Manager: sample print requests and results.' },
  /** Approval levels (QUO-06) and SLA escalation (SRV-09) shown by role name, not by number. */
  approvalLevels: { 1: 'Sales Manager', 2: 'Division Head', 3: 'Management (MD)' },
  escalationLevels: { 1: 'Service Manager', 2: 'Service Head', 3: 'GM', 4: 'MD' },
} as const;
