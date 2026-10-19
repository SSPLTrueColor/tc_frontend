/** Dispatch & Delivery labels (docs/GLOSSARY.md §1.2, §2.2, §3; BRD 4.6 INS-01 / INS-02). The Dispatch record is filled by the orders module. */
export const dispatch = {
  records: {
    dispatches: { one: 'Dispatch', many: 'Dispatch & Delivery' },
  },
  descriptions: {
    dispatches: 'Dispatch and delivery tracking per sales order: transporter, LR number, e-way bill, expected vs actual delivery and signed proof of delivery.',
  },
  fields: {
    dispatches: {
      salesOrderId: 'Sales order',
      customerId: 'Customer',
      dispatchDate: 'Dispatch date',
      transporter: 'Transporter',
      transporterPlaceholder: 'e.g. VRL Logistics',
      lrNumber: 'LR number',
      challanNo: 'Delivery challan',
      invoiceRef: 'Invoice number',
      ewayBill: 'E-way bill reference',
      ewayBillHelp: '12 digits',
      ewayBillPattern: 'E-way bill references have 12 digits',
      expectedDelivery: 'Expected delivery',
      expectedDeliveryCompare: 'Expected delivery cannot be before the dispatch date',
      actualDelivery: 'Delivered on',
      podFileName: 'Signed proof of delivery',
      podPhotoName: 'Delivery photo',
      status: 'Dispatch status',
      delayDays: 'Delay (days)',
      ownerId: 'Sales executive',
      divisionId: 'Division',
      notifyCustomer: 'Send dispatch intimation to the customer',
    },
  },
  sections: {
    dispatches: { main: 'Dispatch', delivery: 'Delivery' },
  },
  views: {
    dispatches: { transit: 'In Transit', delayed: 'Delayed', all: 'All Dispatches' },
  },
  masters: {
    dispatchStatus: { label: 'Dispatch Status', values: { in_transit: 'In Transit', delivered: 'Delivered' } },
  },
  actions: {
    recordDispatch: 'Record Dispatch',
    confirmDelivery: 'Confirm Delivery',
  },
  dialogs: {
    recordTitle: (orderNo: string) => `Record Dispatch · ${orderNo}`,
    recordDescription: 'Creates the dispatch record, moves the sales order to Dispatched and (optionally) sends the dispatch intimation by WhatsApp / e-mail (simulated).',
    deliveryTitle: (lr: string) => `Confirm Delivery · LR ${lr}`,
    deliveryDescription: 'Records the actual delivery with the signed proof of delivery. Machine orders get an installation job automatically.',
  },
  messages: {
    dispatched: (lr: string) => `Dispatched; LR number ${lr}`,
    delivered: 'Delivery confirmed',
    deliveredWithJob: (id: string) => `Delivered; installation job ${id} created`,
  },
} as const;
