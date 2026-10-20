/** Consolidated read model. Original lead/opportunity records retain their own permissions and history. */
import { type Actor, canReadResource } from './authz';
import { queryRecords, recordTitle } from './runtime';
import { masterValue } from './registry';
import type { RecordData } from '../metadata/types';

export function salesRows(actor: Actor) {
  return (['leads', 'opportunities'] as const).filter((key) => canReadResource(actor, key)).flatMap((resource) =>
    queryRecords(actor, resource).rows
      // A converted lead is represented by its opportunity in the combined view.
      .filter((record) => resource !== 'leads' || record.status !== 'qualified')
      .map((record: RecordData) => ({
        resource, record, key: `${resource}:${record.id}`,
        name: recordTitle(resource, record.id, actor),
        customer: recordTitle('customers', record.customerId, actor),
        owner: recordTitle('employees', record.ownerId, actor),
        stage: masterValue(resource === 'leads' ? 'leadStatus' : 'oppStage', record.status ?? record.stage),
      })),
  );
}
