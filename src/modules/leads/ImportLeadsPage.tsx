import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resourcePath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { leadsApi } from '../../services/api/leads';
import { can, perm } from '../../services/authz';
import { downloadText } from '../../services/exporter';
import { useActor } from '../../services/hooks';
import { importTemplateCsv, parseCsv, previewImport, scanVisitingCard, toImportRows, type ImportRow } from '../../services/leads/rules';
import { Button } from '../../components/primitives/Button';
import { EmptyState, InlineAlert, NoAccess, useToast } from '../../components/primitives/feedback';
import { ListPage } from '../../components/shell/ListPage';
import { DataTable, type Column } from '../../components/primitives/DataTable';
import { Menu } from '../../components/primitives/overlay';
import { L } from '../../constants/labels';
import { TextField, Textarea } from '../../components/primitives/controls';
import { FileInput } from '../../components/primitives/controls';

const T = L.leads.pages.importLeads;
const A = L.leads.actions;

/** LEAD-05 / FR-016–017: exhibition lead import (CSV saved from Excel) with validation, plus simulated card scan. */
export function ImportLeadsPage() {
  const actor = useActor();
  const toast = useToast();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [eventName, setEventName] = useState('');
  const [fileError, setFileError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!can(actor, 'leads.import') || !perm(actor, 'leads').create) return <NoAccess what={T.noAccess} />;

  const preview = previewImport(actor, rows);
  const valid = preview.filter((r) => !r.errors.length).length;

  const load = (text: string) => {
    try {
      setRows(toImportRows(parseCsv(text)));
      setFileError('');
    } catch (e) {
      setFileError(errorMessage(e));
    }
  };

  const columns: Column<(typeof preview)[number] & { idx: number }>[] = [
    { key: 'line', label: T.cols.line, sort: (r) => r.line, render: (r) => r.line },
    { key: 'company', label: T.cols.company, sort: (r) => String(r.values.company ?? ''), render: (r) => r.values.company },
    { key: 'contact', label: T.cols.contact, sort: (r) => String(r.values.contact_name ?? ''), render: (r) => r.values.contact_name },
    { key: 'reach', label: T.cols.reach, render: (r) => [r.values.mobile, r.values.email].filter(Boolean).join(' · ') },
    { key: 'division', label: T.cols.division, sort: (r) => String(r.values.division ?? ''), render: (r) => r.values.division },
    {
      key: 'check',
      label: T.cols.check,
      sort: (r) => r.errors.length,
      render: (r) => (
        <>
          {r.errors.map((e) => (
            <div key={e} className="text-danger small">
              {e}
            </div>
          ))}
          {r.warnings.map((w) => (
            <div key={w} className="muted small">
              ⚠ {w}
            </div>
          ))}
          {!r.errors.length && !r.warnings.length && <span className="tag tone-success">{T.ready}</span>}
        </>
      ),
    },
    {
      key: 'act',
      label: T.cols.remove,
      render: (r) => (
        <Button variant="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== r.idx))}>
          {A.remove}
        </Button>
      ),
    },
  ];
  const data = preview.map((r, idx) => ({ ...r, idx }));
  const doImport = async () => {
    setBusy(true);
    setError('');
    try {
      const out = await leadsApi.import(actor, preview, eventName);
      toast(T.done(out.created.length, out.skipped));
      setRows([]);
      navigate(resourcePath(actor.workspaceId, 'leads', { view: 'v_leads_by_source' }));
    } catch (e) {
      setError(errorMessage(e));
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ListPage
      title={L.nav.pages.importLeads.title}
      description={T.description}
      actions={
        <>
          <AddRowsMenu onTemplate={() => downloadText(T.templateFile, importTemplateCsv())} onCsv={() => fileRef.current?.click()} onCard={() => (setRows((r) => [...r, scanVisitingCard()]), toast(T.cardRead, 'info'))} />
          <Button variant="primary" loading={busy} disabledReason={!valid ? T.noValid : !eventName.trim() ? T.enterEvent : undefined} onClick={doImport}>
            {A.importCount(valid)}
          </Button>
        </>
      }
    >
      <FileInput
        ref={fileRef}
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (f.size > 2 * 1024 * 1024) return setFileError(T.fileTooLarge);
          f.text().then(load);
        }}
      />
      {fileError && (
        <InlineAlert tone="danger" title={T.fileErrorTitle}>
          {fileError}
        </InlineAlert>
      )}
      <div className="form-grid imp-form">
        <div className="form-field">
          <label className="field-label" htmlFor="imp-event">
            {T.eventName} <span className="req">*</span>
          </label>
          <TextField id="imp-event" maxLength={80} placeholder={T.eventPlaceholder} value={eventName} onChange={(e) => setEventName(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="field-label" htmlFor="imp-paste">
            {T.paste}
          </label>
          <Textarea id="imp-paste" className="textarea" rows={2} placeholder={T.pastePlaceholder} onBlur={(e) => e.target.value.trim() && load(e.target.value)} />
        </div>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {preview.length ? (
        <DataTable
          label={T.tableLabel}
          noun={T.noun}
          rows={data}
          rowKey={(r) => String(r.idx)}
          columns={columns}
          selectable={false}
          initialSort={{ key: 'line', dir: 'asc' }}
          summary={
            <>
              {T.summary(preview.length, valid, preview.length - valid)} ·{' '}
              <button type="button" className="link small" onClick={() => setRows([])}>
                {A.clear}
              </button>
            </>
          }
        />
      ) : (
        <div className="content-surface">
          <EmptyState icon="download" title={T.emptyTitle}>
            {T.emptyBody}
          </EmptyState>
        </div>
      )}
    </ListPage>
  );
}

/** Three ways to add rows in one menu, so the header carries a single primary button. */
function AddRowsMenu({ onTemplate, onCsv, onCard }: { onTemplate: () => void; onCsv: () => void; onCard: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button ref={ref} icon="plus" iconRight="chevron-down" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {T.addRows}
      </Button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref}
        label={T.addRowsLabel}
        items={[
          { id: 'csv', label: A.chooseCsv, icon: 'arrow-up', onSelect: onCsv },
          { id: 'card', label: A.scanCard, icon: 'id-card', onSelect: onCard },
          { id: 'tpl', label: A.downloadTemplate, icon: 'download', onSelect: onTemplate, separatorBefore: true },
        ]}
      />
    </>
  );
}
