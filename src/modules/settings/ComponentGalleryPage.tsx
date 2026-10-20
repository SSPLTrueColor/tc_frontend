import { useState } from 'react';
import { L } from '../../constants/labels';
import type { Tone } from '../../metadata/types';
import { Button, IconButton } from '../../components/primitives/Button';
import { Checkbox, Radio, SearchInput, SegmentedControl, Switch, TextField, Textarea } from '../../components/primitives/controls';
import { DatePicker } from '../../components/primitives/DatePicker';
import { Column, DataTable } from '../../components/primitives/DataTable';
import { EmptyState, ErrorState, InlineAlert, StatusChip, Tabs, useToast, Badge, Avatar } from '../../components/primitives/feedback';
import { Pagination } from '../../components/primitives/Pagination';
import { confirmDelete, Dialog } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { Skeleton, SkeletonBlock, SkeletonLine } from '../../components/primitives/Skeleton';
import { Table } from '../../components/primitives/Table';
import { SettingsField, SettingsPage, SettingsSection } from '../../components/settings/kit';

const G = L.gallery;
const TONES: Tone[] = ['neutral', 'info', 'success', 'warning', 'danger', 'accent'];
interface Row {
  id: string;
  name: string;
  amount: number;
  status: Tone;
}
const ROWS: Row[] = Array.from({ length: 60 }, (_, i) => ({ id: `R-${i + 1}`, name: `Sample company ${i + 1}`, amount: (i + 1) * 12500, status: TONES[i % TONES.length] }));
const COLUMNS: Column<Row>[] = [
  { key: 'id', label: 'ID', render: (r) => r.id, sort: (r) => r.id },
  { key: 'name', label: 'Name', render: (r) => r.name, sort: (r) => r.name },
  { key: 'amount', label: 'Amount', num: true, render: (r) => `₹${r.amount.toLocaleString('en-IN')}`, sort: (r) => r.amount },
  { key: 'status', label: 'Status', render: (r) => <StatusChip label={r.status} tone={r.status} /> },
];

/** Every shared component in every state — for design review and the automated consistency checks (Demo → Component Gallery). */
export function ComponentGalleryPage() {
  const toast = useToast();
  const [seg, setSeg] = useState('a');
  const [on, setOn] = useState(true);
  const [sel, setSel] = useState('one');
  const [date, setDate] = useState<string | null>('2026-10-20');
  const [tab, setTab] = useState('first');
  const [dlg, setDlg] = useState(false);
  const [page, setPage] = useState(0);
  return (
    <SettingsPage title={L.nav.pages.componentGallery.title} description={G.description}>
      <SettingsSection wide title={G.buttons} help={G.buttonsHelp}>
        <div className="st-actions" data-gallery="buttons">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" icon="plus">
            With icon
          </Button>
          <Button loading>Loading</Button>
          <Button disabledReason="Not allowed for your role">Disabled</Button>
          <IconButton icon="pencil" label="Edit" />
          <IconButton icon="trash" label="Delete" variant="secondary" />
          <IconButton icon="plus" label="Unavailable" disabledReason="Nothing to add" />
        </div>
      </SettingsSection>

      <SettingsSection title={G.fields} help={G.fieldsHelp}>
        <SettingsField label="Text field" htmlFor="g-text" help="Helper text sits under the field.">
          <TextField id="g-text" defaultValue="Rahul Mehta" />
        </SettingsField>
        <SettingsField label="Invalid" htmlFor="g-bad" error="This is what an error looks like">
          <TextField id="g-bad" invalid defaultValue="" />
        </SettingsField>
        <SettingsField label="Disabled" htmlFor="g-dis">
          <TextField id="g-dis" disabled defaultValue="Read only" />
        </SettingsField>
        <SettingsField label="Search (dense, 32 px)" htmlFor="g-search">
          <SearchInput id="g-search" aria-label="Search" placeholder="Search…" />
        </SettingsField>
        <SettingsField label="Textarea" htmlFor="g-area">
          <Textarea id="g-area" rows={3} defaultValue="Multi-line text" />
        </SettingsField>
        <SettingsField label="Select" htmlFor="g-sel">
          <SelectMenu id="g-sel" label="Select" value={sel} onChange={setSel} options={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]} />
        </SettingsField>
        <SettingsField label="Date" htmlFor="g-date">
          <DatePicker id="g-date" label="Date" value={date} onChange={setDate} />
        </SettingsField>
      </SettingsSection>

      <SettingsSection title={G.choices} help={G.choicesHelp}>
        <label className="check">
          <Checkbox defaultChecked /> Checkbox
        </label>
        <label className="check">
          <Radio name="g-radio" defaultChecked /> Radio
        </label>
        <Switch checked={on} onChange={setOn} label="Switch" text={on ? 'On' : 'Off'} />
        <SegmentedControl label="Segmented" value={seg} onChange={setSeg} options={[{ value: 'a', label: 'Month' }, { value: 'b', label: 'Quarter' }, { value: 'c', label: 'Year' }]} />
        <Tabs label="Tabs" value={tab} onChange={setTab} tabs={[{ id: 'first', label: 'First' }, { id: 'second', label: 'Second', count: 3 }]} />
      </SettingsSection>

      <SettingsSection title={G.status} help={G.statusHelp}>
        <div className="st-actions" data-gallery="chips">
          {TONES.map((t) => (
            <StatusChip key={t} label={t} tone={t} />
          ))}
        </div>
        <div className="st-actions">
          {TONES.map((t) => (
            <Badge key={t} tone={t}>
              {t}
            </Badge>
          ))}
          <Avatar name="Rahul Mehta" />
        </div>
        <InlineAlert tone="info">Info alert</InlineAlert>
        <InlineAlert tone="success">Success alert</InlineAlert>
        <InlineAlert tone="warning">Warning alert</InlineAlert>
        <InlineAlert tone="danger">Danger alert</InlineAlert>
      </SettingsSection>

      <SettingsSection title={G.states} help={G.statesHelp}>
        <EmptyState icon="inbox" title="Nothing here yet" action={<Button variant="primary">Create the first one</Button>}>
          Records you create will appear here.
        </EmptyState>
        <ErrorState title="Could not load the list" onRetry={() => undefined}>
          The network failed. Nothing was lost.
        </ErrorState>
        <Skeleton rows={3} />
        <div>
          <SkeletonLine size="title" />
          <SkeletonLine size="value" />
          <SkeletonBlock />
        </div>
      </SettingsSection>

      <SettingsSection wide title={G.tables} help={G.tablesHelp}>
        <DataTable rows={ROWS} columns={COLUMNS} rowKey={(r) => r.id} label="Sample" noun="companies" search={(r) => `${r.id} ${r.name}`} initialSort={{ key: 'id', dir: 'asc' }} pageSize={5} />
        <Table>
          <thead>
            <tr>
              <th scope="col">Static table</th>
              <th scope="col" className="num">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Row</td>
              <td className="num">₹1,25,000</td>
            </tr>
          </tbody>
        </Table>
        <Pagination page={page} pageSize={25} total={240} noun="records" onPage={setPage} onSize={() => undefined} />
      </SettingsSection>

      <SettingsSection title={G.overlays} help={G.overlaysHelp}>
        <div className="st-actions">
          <Button onClick={() => setDlg(true)}>Open dialog</Button>
          <Button onClick={() => toast('Saved', 'success')}>Success toast</Button>
          <Button onClick={() => toast('Something failed', 'danger')}>Error toast</Button>
          <Button variant="danger" onClick={() => confirmDelete({ title: 'Delete this record?', message: 'It moves to the recycle bin.', onConfirm: () => undefined })}>
            Confirm (delete)
          </Button>
          <Button variant="danger" onClick={() => confirmDelete({ title: 'Reset everything?', message: 'This cannot be undone.', confirmLabel: 'Reset', typedWord: 'RESET', onConfirm: () => undefined })}>
            Confirm (typed)
          </Button>
        </div>
        <Dialog open={dlg} onClose={() => setDlg(false)} title="Dialog title" footer={<Button onClick={() => setDlg(false)}>Close</Button>}>
          <p>Dialogs have a title, body and a footer with the actions, the primary one last.</p>
        </Dialog>
      </SettingsSection>
    </SettingsPage>
  );
}
