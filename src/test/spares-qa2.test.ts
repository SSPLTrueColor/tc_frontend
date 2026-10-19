import '../domain/extensions/spares';
import { actorFor, can } from '../services/authz';
import { commit, createDb, getDb, __setDb } from '../services/db';
import { createRecord, deleteRecord, transitionRecord, updateRecord, queryRecords } from '../services/runtime';
import { leakageList, reorderList, repeatOrderList, dealerOrderList } from '../services/spares/consumables';
import { engineerStock } from '../services/spares/stock';
import { minimumLevelAlerts, syncStockFromErp } from '../services/spares/requisitions';

const probe = (name: string, fn: () => unknown) => {
  try {
    const r = fn();
    console.log('PROBE', name, 'OK', JSON.stringify(r)?.slice(0, 200));
  } catch (e) {
    console.log('PROBE', name, 'THREW', (e as Error).message, JSON.stringify((e as { fieldErrors?: unknown }).fieldErrors ?? ''));
  }
};

describe('probe2', () => {
  it('probes', () => {
    __setDb(createDb(new Date('2026-10-19T10:00:00')));
    const users = ['u_rahul', 'u_vikram', 'u_suresh', 'u_rohan', 'u_karan', 'u_sneha', 'u_manoj', 'u_sanjay', 'u_ravi', 'u_meera', 'u_rajesh', 'u_prakash', 'u_swati', 'u_tanvi'];
    for (const u of users) {
      const a = actorFor(u, 'tc');
      const caps = ['approve.service', 'spares.issue', 'spares.stock', 'spares.erpSync', 'spares.engineerStockAll', 'consumables.view'].filter((c) => can(a, c));
      const counts = ['spareParts', 'requisitions', 'warrantyClaims', 'rateContracts', 'sampleDispatches', 'dealerOrders'].map((k) => {
        try { return `${k}:${queryRecords(a, k, { pageSize: 1000 }).total}`; } catch (e) { return `${k}:X`; }
      });
      const pages = { stock: 0, eng: 0, min: 0, leak: 0, reorder: 0, repeat: 0, dealer: 0 } as Record<string, unknown>;
      const t = (k: string, f: () => unknown) => { try { pages[k] = f(); } catch { pages[k] = 'X'; } };
      t('eng', () => { const r = engineerStock(a); return `${r.scope}/${r.engineers.length}`; });
      t('min', () => minimumLevelAlerts(a).below.length);
      t('leak', () => leakageList(a).rows.length);
      t('reorder', () => reorderList(a).rows.length);
      t('repeat', () => repeatOrderList(a).rows.length);
      t('dealer', () => dealerOrderList(a).rows.length);
      console.log('ROLE', u, a.role.id, caps.join(','), counts.join(' '), JSON.stringify(pages));
    }
    const admin = actorFor('u_rahul', 'tc');
    // rate contract reactivation overlap
    const rc = getDb().records.rateContracts[0];
    console.log('rc0', JSON.stringify(rc));
    probe('rc duplicate inactive then reactivate', () => {
      const x = createRecord(admin, 'rateContracts', { customerId: rc.customerId, productId: rc.productId, rate: 10, validFrom: rc.validFrom, validTo: rc.validTo, status: 'inactive' }).record;
      return updateRecord(admin, 'rateContracts', x.id, { status: 'active' }, x.version).record.status;
    });
    // sample flows
    const sd = getDb().records.sampleDispatches.find((s) => s.status === 'requested')!;
    probe('sd requested->results', () => transitionRecord(admin, 'sampleDispatches', sd.id, 'results', sd.version).record.status);
    probe('sd requested->trial', () => transitionRecord(admin, 'sampleDispatches', sd.id, 'trial', sd.version).record.status);
    const done = getDb().records.sampleDispatches.find((s) => s.status === 'results')!;
    probe('sd edit results record', () => updateRecord(admin, 'sampleDispatches', done.id, { trialResult: 'negative' }, done.version).record.trialResult);
    const tanvi = actorFor('u_tanvi', 'tc');
    probe('profiling create sample', () => createRecord(tanvi, 'sampleDispatches', { customerId: sd.customerId, productId: sd.productId, qty: 1 }).record.id);
    // claims
    const wc = getDb().records.warrantyClaims.find((c) => c.status === 'raised')!;
    console.log('wc', JSON.stringify(wc));
    probe('wc raised->credited', () => transitionRecord(admin, 'warrantyClaims', wc.id, 'credited', wc.version).record.status);
    // requisition terminal edits
    const consumed = getDb().records.requisitions.find((r) => r.status === 'consumed')!;
    const eng2 = getDb().records.employees.find((e) => e.roleId === 'engineer' && e.id !== consumed.engineerId)!;
    probe('edit engineer on consumed req', () => updateRecord(admin, 'requisitions', consumed.id, { engineerId: eng2.id }, consumed.version).record.engineerId);
    const c2 = getDb().records.requisitions.find((r) => r.id === consumed.id)!;
    probe('edit urgency on consumed req', () => updateRecord(admin, 'requisitions', consumed.id, { urgency: 'urgent' }, c2.version).record.urgency);
    probe('delete consumed req (admin)', () => deleteRecord(admin, 'requisitions', consumed.id));
    // dealer delete by sales exec / manager
    const rohan = actorFor('u_rohan', 'tc');
    const dl = dealerOrderList(rohan);
    console.log('rohan dealer', dl.rows.length, dl.canDelete, dl.dealers.length);
    const karan = actorFor('u_karan', 'tc');
    const dk = dealerOrderList(karan);
    console.log('karan dealer', dk.rows.length, dk.canCreate, dk.canDelete, 'dealers offered', dk.dealers.length);
    probe('erp sync scm', () => syncStockFromErp(actorFor('u_rajesh', 'tc')));
    commit(() => undefined);
  });
});
