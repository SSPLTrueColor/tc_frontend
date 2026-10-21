/**
 * Re-test fixes (21-10-2026): notification templates on staff alerts and quotation sends, the synchronous
 * double-submit guard on generic record forms, Convert to Lead fields that follow the SELECTED lead source,
 * opportunity value > 0, one "before GST" value basis (D-1), the Not Selected Deal Journey, the ERP push in
 * the Integration Log and distinct master names.
 */
import '../domain/extensions/index';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { L } from '../constants/labels';
import { todayKey } from '../lib/dates';
import { demoUsers } from '../domain/pack';
import type { RecordData } from '../metadata/types';
import { actorFor, type Actor, canReadRecord } from '../services/authz';
import { __setDb, createDb, getDb } from '../services/db';
import { listPriceFor, recordsOfCustomer } from '../services/lookups';
import { allMasters, getResource } from '../services/registry';
import { createRecord } from '../services/runtime';
import { convertContactToLead, leadSourceFields } from '../services/customers/operations';
import { acceptQuote, saveQuote, sendQuote, submitQuote } from '../services/quotations/workflow';
import { valueBeforeGst, type QuoteLine } from '../services/quotations/pricing';
import { netValue } from '../services/reports/kpis';
import * as so from '../services/orders/orders';
import { canDecide, decideApproval } from '../services/workflow';
import { integrationLog } from '../services/catalog/integrations';
import { ServiceError } from '../services/types';
import { useRecordForm } from '../components/resource/RecordForm';
import { DealChain } from '../components/resource/DealChain';
import { ToastProvider } from '../components/primitives/feedback';
import { ConvertDialog } from '../modules/customers/components';
import { masterLabel } from '../services/registry';

const WS = 'tc';
const A = (u: string) => actorFor(u, WS);
const q = (id: string) => getDb().records.quotations.find((x) => x.id === id)!;
const tpl = (event: string, channel: string) => getDb().records.notificationTemplates.find((t) => t.event === event && t.channel === channel)!;

function line(discountPct = 0): QuoteLine {
  const d = getDb();
  const product = d.records.products.find((p) => p.productType === 'machine' && listPriceFor(p.id, todayKey())) ?? d.records.products.find((p) => listPriceFor(p.id, todayKey()))!;
  return { productId: product.id, description: String(product.name), lineType: 'machine', qty: 1, listPrice: 1, discountPct, discountAmt: 0, hsnSac: String(product.hsnSac), gstRate: Number(product.gstRate) };
}

/** An open opportunity of Karan with no quotations, a site address and an email-consenting contact. */
function openOpp(): { karan: Actor; opp: RecordData } {
  const d = getDb();
  const karan = A('u_karan');
  const opp = d.records.opportunities.find(
    (x) =>
      ['needs_assessment', 'demo', 'proposal', 'negotiation'].includes(String(x.stage)) &&
      x.ownerId === karan.staffId &&
      !d.records.quotations.some((qq) => qq.opportunityId === x.id) &&
      recordsOfCustomer('addresses', String(x.customerId)).length,
  )!;
  expect(opp).toBeTruthy();
  return { karan, opp };
}

function approvedQuote(karan: Actor, oppId: string, freight = 0): string {
  const id = saveQuote(karan, { header: { opportunityId: oppId, freight }, lines: [line()] }).record.id;
  submitQuote(karan, id, q(id).version);
  expect(q(id).status).toBe('approved');
  return id;
}

function sentQuote(karan: Actor, oppId: string): string {
  const id = approvedQuote(karan, oppId);
  sendQuote(karan, id, q(id).version, { channel: 'manual', to: '', message: '' });
  return id;
}

describe('re-test fixes', () => {
  beforeEach(() => {
    __setDb(createDb(new Date()));
    getDb().demo.latencyMin = 0;
    getDb().demo.latencyMax = 0;
    getDb().demo.failureRate = 0;
  });

  // ------------------------------------------------------------------ 1. notification templates

  it('1: staff approval emails are rendered from the "Approval requested" template (edited text is used)', () => {
    const t = tpl('approval_requested', 'email');
    t.subject = '[QA-TPL] Please approve {{record}}';
    t.body = '[QA-TPL] {{owner}} asks you to approve {{record}} for {{amount}}. {{link}}';
    t.updatedAt = new Date().toISOString();
    const { karan, opp } = openOpp();
    const id = saveQuote(karan, { header: { opportunityId: opp.id }, lines: [line(12)] }).record.id;
    submitQuote(karan, id, q(id).version, 'Competitive offer from importer');
    const mail = getDb().outbox.find((m) => m.audience === 'staff' && m.channel === 'email' && m.related?.recordId === id);
    expect(mail, 'an approval email to the approver').toBeTruthy();
    expect(mail!.subject).toBe(`[QA-TPL] Please approve ${q(id).quoteNo}`);
    expect(mail!.body).toContain('[QA-TPL] Karan Singh asks you to approve');
    expect(mail!.body).not.toContain('{{');
    expect(mail!.templateName).toBe(t.name);
  });

  it('1: a staff alert without an active template keeps the default text', () => {
    tpl('approval_requested', 'email').status = 'inactive';
    const { karan, opp } = openOpp();
    const id = saveQuote(karan, { header: { opportunityId: opp.id }, lines: [line(12)] }).record.id;
    submitQuote(karan, id, q(id).version, 'Competitive offer from importer');
    const mail = getDb().outbox.find((m) => m.audience === 'staff' && m.channel === 'email' && m.related?.recordId === id)!;
    expect(mail.subject).toMatch(/^True Colors CRM: /);
    expect(mail.templateName).toBeUndefined();
  });

  it('1: quotation send always uses the "Quotation sent" template — the dialog salutation no longer defeats it', () => {
    const t = tpl('quotation_sent', 'email');
    t.subject = '[QA-TPL6] Quotation {{record}}';
    t.body = '[QA-TPL6] Dear {{contact}}, quotation {{record}} for {{amount}}.';
    t.updatedAt = new Date().toISOString();
    const { karan, opp } = openOpp();
    const id = approvedQuote(karan, opp.id);
    const no = String(q(id).quoteNo);
    // The Send dialog's untouched pre-fill ("Dear <contact>, Please find attached…") → template body.
    const prefill = L.quotations.dialogs.send.defaultMessage('Srinivas Jain', no, '31-10-2026', karan.user.name);
    sendQuote(karan, id, q(id).version, { channel: 'email', to: 'buyer@example.com', message: prefill, messageEdited: false });
    const first = getDb().outbox.find((m) => m.related?.recordId === id && m.audience === 'customer')!;
    expect(first.subject).toBe(`[QA-TPL6] Quotation ${no}`);
    expect(first.body).toMatch(/^\[QA-TPL6\] Dear /);
    expect(first.body).toContain(L.quotations.audit.attachment(no));
    expect(first.event).toBe('quotation_sent');
    // The user edited the message: their text is sent as written, the subject still comes from the template.
    sendQuote(karan, id, q(id).version, { channel: 'email', to: 'buyer@example.com', message: 'Hi, our best price is attached.', messageEdited: true });
    const second = getDb().outbox.find((m) => m.related?.recordId === id && m.audience === 'customer')!;
    expect(second.id).not.toBe(first.id);
    expect(second.subject).toBe(`[QA-TPL6] Quotation ${no}`);
    expect(second.body).toBe(`Hi, our best price is attached. ${L.quotations.audit.attachment(no)}`);
  });

  // ------------------------------------------------------------------ 2. double submit

  it('2: a double click on a generic create form creates exactly one record (synchronous ref guard)', () => {
    const before = (getDb().records.termsTemplates ?? []).length;
    const { result } = renderHook(() => useRecordForm({ resKey: 'termsTemplates' }));
    act(() => {
      result.current.setValues((v) => ({ ...v, name: 'QA double click', divisionId: 'TX', status: 'active', paymentTerms: 'Advance 30%', deliveryTerms: '4 weeks', warrantyTerms: '12 months' }));
    });
    const outs: unknown[] = [];
    // Two clicks in the same frame: the second sees the same (stale) React state.
    act(() => {
      const submit = result.current.submit;
      void submit().then((o) => outs.push(o));
      void submit().then((o) => outs.push(o));
    });
    return Promise.resolve().then(() => {
      expect((getDb().records.termsTemplates ?? []).length).toBe(before + 1);
      // A later click after the re-render is refused too: the form is finished once its record exists.
      return result.current.submit().then((late) => {
        expect(late).toBeNull();
        expect((getDb().records.termsTemplates ?? []).length).toBe(before + 1);
      });
    });
  });

  // ------------------------------------------------------------------ 3. Convert to Lead

  it('3: source-dependent lead fields follow the SELECTED source (Exhibition / Trade Show → event name)', () => {
    expect(leadSourceFields('exhibition')).toContainEqual({ key: 'eventName', required: true });
    expect(leadSourceFields('website').some((f) => f.key === 'eventName')).toBe(false);
    const d = getDb();
    const karan = A('u_karan');
    const contact = d.records.contacts.find((c) => !c.customerId && c.poolStatus !== 'converted' && c.source !== 'exhibition' && canReadRecord(karan, getResource('contacts'), c))!;
    expect(contact).toBeTruthy();
    const base = { contactId: contact.id, companyName: `QA Exhibition ${contact.id}`, territoryId: 'surat', divisionId: 'TX', productType: 'machine', ownerId: String(karan.staffId), nextFollowUpAt: todayKey(), sourceId: 'exhibition' };
    let err: ServiceError | undefined;
    try {
      convertContactToLead(karan, base);
    } catch (e) {
      err = e as ServiceError;
    }
    expect(err?.code).toBe('validation');
    expect(err?.fieldErrors?.eventName).toBe(L.customers.messages.eventRequired);
    const r = convertContactToLead(karan, { ...base, eventName: 'Gartex Texprocess, Mumbai 2026' });
    expect(getDb().records.leads.find((l) => l.id === r.leadId)).toMatchObject({ sourceId: 'exhibition', eventName: 'Gartex Texprocess, Mumbai 2026' });
  });

  it('3: the Convert dialog shows the Event field when Exhibition / Trade Show is PICKED, and a failed save is never silent', async () => {
    const karan = A('u_karan');
    const contact = getDb().records.contacts.find((c) => !c.customerId && c.poolStatus !== 'converted' && c.source !== 'exhibition' && canReadRecord(karan, getResource('contacts'), c))!;
    expect(contact).toBeTruthy();
    const V = L.customers.convert;
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <ConvertDialog actor={karan} contact={contact} onClose={() => {}} />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(new RegExp(V.eventName))).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: new RegExp(`^${V.sourceId}:`) }));
    await user.click(screen.getByRole('option', { name: masterLabel('leadSource', 'exhibition') }));
    expect(screen.getByLabelText(new RegExp(V.eventName))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: L.customers.actions.createLead }));
    // The event-name error shows under the field and in a toast.
    expect((await screen.findAllByText(new RegExp(L.customers.messages.eventRequired))).length).toBeGreaterThan(0);
    expect(getDb().records.leads.some((l) => l.contactId === contact.id)).toBe(false);
  });

  // ------------------------------------------------------------------ 4. opportunity value

  it('4: an opportunity cannot be created or saved with value 0', () => {
    const karan = A('u_karan');
    const cust = getDb().records.customers.find((c) => (c.divisionIds as string[] | undefined)?.includes('TX'))!;
    let err: ServiceError | undefined;
    try {
      createRecord(karan, 'opportunities', { name: 'QA zero', customerId: cust.id, divisionId: 'TX', oppType: 'new_machine', value: 0, expectedCloseDate: todayKey(), ownerId: karan.staffId });
    } catch (e) {
      err = e as ServiceError;
    }
    expect(err?.fieldErrors?.value).toBeTruthy();
  });

  // ------------------------------------------------------------------ 5. one value basis (D-1)

  it('5: won opportunity value = sales order taxable value = dashboard net value (before GST)', () => {
    const { karan, opp } = openOpp();
    const id = approvedQuote(karan, opp.id, 25_000);
    const draft = so.draftFromQuotation(karan, id);
    const order = so.createOrder(karan, { source: 'quotation', sourceId: id, lines: draft.lines, customerPoNo: 'PO/D1/1', customerPoDate: todayKey(), poFileName: 'po.pdf', poFileSize: 1000, siteAddressId: draft.siteAddresses[0]?.id, idempotencyKey: 'd1-order' });
    expect(Number(order.freight)).toBe(25_000); // freight is part of the taxable value
    const won = getDb().records.opportunities.find((o) => o.id === opp.id)!;
    expect(won.stage).toBe('won');
    expect(Number(won.value)).toBe(Number(order.taxable));
    expect(netValue(order)).toBe(Number(order.taxable));
    expect(valueBeforeGst(order)).toBeLessThan(Number(order.grandTotal));
  });

  it('5: accepting a quotation sets the won value to its taxable value, not the GST-inclusive total', () => {
    const { karan, opp } = openOpp();
    const id = sentQuote(karan, opp.id);
    acceptQuote(karan, id, q(id).version, { method: 'po', poNo: 'PO/D1/2', poDate: todayKey(), file: { name: 'po.pdf', size: 2048 } });
    const won = getDb().records.opportunities.find((o) => o.id === opp.id)!;
    expect(Number(won.value)).toBe(Number(q(id).taxable));
    expect(Number(won.value)).toBeLessThan(Number(q(id).grandTotal));
  });

  // ------------------------------------------------------------------ 6. Not Selected Deal Journey

  it('6: a Not Selected quotation shows a neutral note, not the selected deal’s next step', () => {
    const { karan, opp } = openOpp();
    const a = sentQuote(karan, opp.id);
    const b = sentQuote(karan, opp.id);
    acceptQuote(karan, a, q(a).version, { method: 'po', poNo: 'PO/NS/1', poDate: todayKey(), file: { name: 'po.pdf', size: 2048 } });
    expect(q(b).status).toBe('not_selected');
    const P = L.common.dealProgress;
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DealChain resKey="quotations" recordId={b} actor={karan} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(P.notSelected).length).toBeGreaterThan(0);
    expect(screen.getByText(P.notSelectedFor(String(q(a).quoteNo)))).toBeInTheDocument();
    expect(screen.queryByText(P.nextLabel)).toBeNull();
    expect(screen.queryByText(P.quoteNext.accepted)).toBeNull();
  });

  // ------------------------------------------------------------------ 11 / 12

  it('11: every master has a distinct name in the Masters list', () => {
    const names = allMasters().map((m) => m.label.toLowerCase());
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('12: approving a sales order and Push to ERP are recorded in the Integration Log (simulated)', () => {
    const { karan, opp } = openOpp();
    const id = approvedQuote(karan, opp.id);
    const draft = so.draftFromQuotation(karan, id);
    const order = so.createOrder(karan, { source: 'quotation', sourceId: id, lines: draft.lines, customerPoNo: 'PO/ERP/1', customerPoDate: todayKey(), poFileName: 'po.pdf', poFileSize: 1000, siteAddressId: draft.siteAddresses[0]?.id, idempotencyKey: 'erp-order' });
    for (let i = 0; i < 4; i++) {
      const a = getDb().approvals.find((x) => x.recordId === order.id && x.status === 'pending');
      if (!a) break;
      const approver = demoUsers.map((u) => A(u.id)).find((x) => canDecide(x, a))!;
      decideApproval(approver, a.id, 'approved', 'ok', a.version);
    }
    expect(getDb().records.salesOrders.find((o) => o.id === order.id)!.erpPushedAt).toBeTruthy();
    const admin = A('u_rahul');
    expect(integrationLog(admin).some((e) => e.action === 'integration.erp_order_push' && e.recordId === order.id)).toBe(true);
    so.pushToErp(admin, order.id);
    expect(integrationLog(admin).some((e) => e.action === 'integration.erp_invoice' && e.recordId === order.id)).toBe(true);
  });
});
