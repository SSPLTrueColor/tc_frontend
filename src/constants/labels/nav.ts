/**
 * Sidebar modules and page names (docs/GLOSSARY.md §1).
 * `title` = full BRD name (page title, breadcrumb). `nav` = short sidebar label taken from the same name.
 */
export const nav = {
  modules: {
    home: { title: 'Dashboards & Reports', nav: 'Dashboard' },
    customers: { title: 'Customer & Contact Master', nav: 'Customers & Contacts' },
    leads: { title: 'Lead Management', nav: 'Leads' },
    opportunities: { title: 'Opportunity & Pipeline Management', nav: 'Opportunities & Pipeline' },
    quotations: { title: 'Quotation Management', nav: 'Quotations' },
    orders: { title: 'Sales Order & Sales Contract', nav: 'Sales Orders & Contracts' },
    dispatch: { title: 'Dispatch, Delivery, Installation & Commissioning', nav: 'Dispatch & Installation' },
    installed: { title: 'Installed Base, Warranty & AMC', nav: 'Installed Base & AMC' },
    service: { title: 'Service Ticket Management', nav: 'Service Tickets' },
    spares: { title: 'Spare Parts & Engineer Stock', nav: 'Spare Parts' },
    consumables: { title: 'Consumables & Repeat Business', nav: 'Consumables' },
    field: { title: 'Field Force: Attendance, Visits & Expenses', nav: 'Field Force' },
    targets: { title: 'Targets, Performance & Recognition', nav: 'Targets & Recognition' },
    reports: { title: 'Dashboards & Reports', nav: 'Reports' },
    admin: { title: 'Administration & Configuration', nav: 'Administration' },
  },

  /** Static pages: sidebar label = page title unless `nav` is given. `brd` = BRD reference shown in REQUIREMENTS. */
  pages: {
    // Dashboard (4.13)
    dashboard: { title: 'Dashboard', brd: '4.13' },
    calendar: { title: 'Tasks & Calendar', brd: 'OPP-08' },
    notifications: { title: 'Notifications & Approvals', brd: 'COM-03, QUO-06, SO-04' },

    // Customers & Contacts (4.1)
    contactPool: { title: 'Contact Pool', brd: 'CUS-05' },
    contactPoolImport: { title: 'Import Contacts', brd: 'CUS-05' },
    customer360: { title: 'Customer 360° View', brd: 'CUS-07' },

    // Leads (4.2)
    notAttendedLeads: { title: 'Not Attended Leads', brd: 'LEAD-08' },
    followUps: { title: 'Follow-ups', brd: 'LEAD-09' },
    importLeads: { title: 'Import Leads', brd: 'LEAD-05' },

    // Opportunities & Pipeline (4.3)
    pipeline: { title: 'Pipeline', brd: 'OPP-03' },
    salesForecast: { title: 'Sales Forecast', brd: 'OPP-07' },
    demoMachineCalendar: { title: 'Demo Machine Calendar', brd: 'OPP-04' },

    // Quotations (4.4)
    quotationPendingApprovals: { title: 'Pending Approvals', brd: 'QUO-06, QUO-14' },
    quotationCompare: { title: 'Compare Versions', brd: 'QUO-09' },
    quotationPdf: { title: 'Quotation PDF', brd: 'QUO-08' },

    // Sales Orders & Contracts (4.5)
    paymentSchedule: { title: 'Payment Schedule', brd: 'SO-07' },
    orderProcessing: { title: 'Order Processing', brd: 'SO-08' },
    salesContractPdf: { title: 'Sales Contract PDF', brd: 'SO-05' },

    // Installed Base & AMC (4.7)
    renewalPipeline: { title: 'Renewals', brd: 'IB-05' },

    // Service Tickets (4.8)
    engineerCalendar: { title: 'Engineer Calendar & Map', brd: 'SRV-05' },
    myJobs: { title: 'My Jobs', brd: 'SRV-06' },
    pmSchedule: { title: 'PM Schedule', brd: 'SRV-11' },
    knowledgeBase: { title: 'Knowledge Base', brd: 'SRV-16' },
    jobCard: { title: 'Service Job Card', brd: 'SRV-08' },
    feedback: { title: 'Customer Feedback', brd: 'SRV-12' },
    portalLogTicket: { title: 'Customer Portal – Log Ticket', brd: 'SRV-01' },

    // Spare Parts (4.9)
    mainStoreStock: { title: 'Main Store Stock', brd: 'SPR-02' },
    engineerStock: { title: 'Engineer Stock', brd: '4.9' },
    minimumLevelAlerts: { title: 'Minimum-Level Alerts', brd: 'SPR-06' },

    // Consumables (4.10)
    repeatOrders: { title: 'Repeat Orders', brd: 'CON-02' },
    leakageList: { title: 'Leakage List', brd: 'CON-03' },
    reorderPrediction: { title: 'Reorder Prediction', brd: 'CON-04' },
    dealerOrders: { title: 'Dealer / Distributor Orders', brd: 'CON-06' },

    // Field Force (4.11)
    attendance: { title: 'Attendance (Check-in / Check-out)', nav: 'Attendance', brd: 'ATT-01' },
    teamAttendance: { title: 'Team Attendance', brd: 'ATT-10' },
    exceptionDashboard: { title: 'Exception Dashboard', brd: 'ATT-10' },
    routeMap: { title: 'Route Map', brd: 'ATT-07' },
    fieldVisits: { title: 'Field Visits', brd: 'ATT-05' },
    beatPlan: { title: 'Beat Plan', brd: 'ATT-06' },
    payrollExport: { title: 'Payroll Export', brd: 'ATT-08' },

    // Targets & Recognition (4.12)
    targetVsActual: { title: 'Target vs Actual', brd: 'TGT-02' },
    activityScorecard: { title: 'Weekly Activity Scorecard', brd: 'TGT-03' },
    leaderboards: { title: 'Leaderboards & Recognition', brd: 'TGT-04' },

    // Reports (4.13)
    reports: { title: 'All Reports', brd: '4.13' },
    reportKpis: { title: 'KPIs & CRM Adoption', brd: 'Appendix C, §9.3' },
    reportCustomers: { title: 'Customer Reports', brd: 'CUS-12' },
    reportLeads: { title: 'Lead Reports', brd: 'LEAD-14' },
    reportQuotations: { title: 'Quotation Reports', brd: 'QUO-14' },
    reportSalesOrders: { title: 'Sales Order Reports', brd: 'SO-11' },
    reportInstalledBase: { title: 'Installed Base Reports', brd: 'IB-07' },
    reportService: { title: 'Service Reports', brd: 'SRV-17' },
    reportFieldForce: { title: 'Field Force Reports', brd: 'ATT-10' },

    // Administration (4.14)
    organisationHierarchy: { title: 'Organisation Hierarchy', brd: 'ADM-01' },
    rolesPermissions: { title: 'Roles & Permissions', brd: 'ADM-02' },
    masters: { title: 'Masters', brd: 'ADM-03' },
    customFields: { title: 'Custom Fields & Form Layouts', brd: 'ADM-05' },
    workflows: { title: 'Workflows & Approval Matrices', brd: 'ADM-04' },
    slaMatrix: { title: 'SLA Matrix', brd: 'SRV-04, SRV-09' },
    configurableRules: { title: 'Configurable Rules', brd: 'ADM-04, ADM-09' },
    bulkImportExport: { title: 'Bulk Import / Export', brd: 'ADM-07' },
    duplicateMerge: { title: 'Duplicate Detection & Merge', brd: 'CUS-06' },
    ownershipTransfer: { title: 'Bulk Ownership Transfer', brd: 'CUS-10, ADM-08' },
    integrations: { title: 'Integrations', brd: '§6' },
    auditTrail: { title: 'Audit Trail', brd: 'COM-09' },
    recycleBin: { title: 'Recycle Bin', brd: 'COM-10' },
    sentMessages: { title: 'Sent Messages (Simulated)', brd: 'COM-03' },
    demoSettings: { title: 'Demo Settings', brd: 'NFR simulation' },
  },
} as const;
