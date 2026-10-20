import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { resourcePath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { leadsApi } from '../../services/api/leads';
import { can, perm } from '../../services/authz';
import { downloadText } from '../../services/exporter';
import { useActor } from '../../services/hooks';
import { importTemplateCsv, parseCsv, previewImport, scanVisitingCard, toImportRows, type ImportRow } from '../../services/leads/rules';
import { Button } from '../../components/primitives/Button';
import { InlineAlert, NoAccess, StatusChip, useToast } from '../../components/primitives/feedback';
import { PageHeader } from '../../components/shell/PageHeader';
import { Icon } from '../../components/primitives/Icon';
import { cx } from '../../lib/format';
import { DataTable, type Column } from '../../components/primitives/DataTable';
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
  const [pasted, setPasted] = useState('');
  const [dragging, setDragging] = useState(false);

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

  const skipped = preview.length - valid;
  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return setFileError(T.fileTooLarge);
    f.text().then(load);
  };

  return (
    <div className="page imp-page">
      <PageHeader title={L.nav.pages.importLeads.title} description={T.description} />
      <FileInput
        ref={fileRef}
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          onFile(f);
        }}
      />

      <ImportStep n={1} title={T.steps.event} hint={T.stepHints.event} done={!!eventName.trim()}>
        <div className="form-field imp-event">
          <label className="field-label" htmlFor="imp-event">
            {T.eventName} <span className="req">*</span>
          </label>
          <TextField id="imp-event" maxLength={80} placeholder={T.eventPlaceholder} value={eventName} onChange={(e) => setEventName(e.target.value)} aria-describedby="imp-event-help" />
          <p className="field-help" id="imp-event-help">
            {T.eventHelp}
          </p>
        </div>
      </ImportStep>

      <ImportStep n={2} title={T.steps.add} hint={T.stepHints.add} done={rows.length > 0}>
        {fileError && (
          <InlineAlert tone="danger" title={T.fileErrorTitle}>
            {fileError}
          </InlineAlert>
        )}
        <div className="imp-methods">
          <div
            className={cx('imp-method imp-drop', dragging && 'is-dragging')}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              onFile(e.dataTransfer.files?.[0]);
            }}
          >
            <span className="imp-method-icon tone-accent" aria-hidden="true">
              <Icon name="file-spreadsheet" size={20} />
            </span>
            <strong className="imp-method-title">{T.upload.title}</strong>
            <p className="imp-method-hint">
              {dragging ? (
                T.upload.dragging
              ) : (
                <>
                  {T.upload.drop} {T.upload.or}{' '}
                  <button type="button" className="link" onClick={() => fileRef.current?.click()}>
                    {T.upload.browse}
                  </button>
                </>
              )}
            </p>
            <span className="imp-method-foot muted">{T.upload.hint}</span>
          </div>

          <div className="imp-method">
            <span className="imp-method-icon tone-info" aria-hidden="true">
              <Icon name="clipboard-list" size={20} />
            </span>
            <strong className="imp-method-title">{T.pasteCard.title}</strong>
            <Textarea id="imp-paste" className="textarea imp-paste" rows={3} aria-label={T.paste} placeholder={T.pastePlaceholder} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <Button
              icon="plus"
              disabledReason={pasted.trim() ? undefined : T.pasteCard.hint}
              onClick={() => {
                load(pasted);
                setPasted('');
              }}
            >
              {T.pasteCard.add}
            </Button>
          </div>

          <div className="imp-method">
            <span className="imp-method-icon tone-success" aria-hidden="true">
              <Icon name="id-card" size={20} />
            </span>
            <strong className="imp-method-title">{T.scan.title}</strong>
            <p className="imp-method-hint">{T.scan.hint}</p>
            <Button icon="id-card" onClick={() => (setRows((r) => [...r, scanVisitingCard()]), toast(T.cardRead, 'info'))}>
              {T.scan.action}
            </Button>
          </div>
        </div>
        <p className="imp-template muted">
          {T.templateHint}{' '}
          <button type="button" className="link" onClick={() => downloadText(T.templateFile, importTemplateCsv())}>
            <Icon name="download" size={13} /> {A.downloadTemplate}
          </button>
        </p>
      </ImportStep>

      <ImportStep
        n={3}
        title={T.steps.review}
        hint={T.stepHints.review}
        done={false}
        aside={
          preview.length > 0 && (
            <span className="imp-stats">
              <StatusChip label={T.statRows(preview.length)} tone="neutral" />
              <StatusChip label={T.statReady(valid)} tone="success" />
              {skipped > 0 && <StatusChip label={T.statErrors(skipped)} tone="danger" />}
              <Button variant="ghost" icon="trash" onClick={() => setRows([])}>
                {A.clear}
              </Button>
            </span>
          )
        }
      >
        {preview.length ? (
          <div className="imp-table">
            <DataTable label={T.tableLabel} noun={T.noun} rows={data} rowKey={(r) => String(r.idx)} columns={columns} selectable={false} initialSort={{ key: 'line', dir: 'asc' }} />
          </div>
        ) : (
          <div className="imp-review-empty">
            <Icon name="table" size={18} />
            {T.reviewEmpty}
          </div>
        )}
      </ImportStep>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="imp-footer">
        <span className={cx('imp-footer-text', valid > 0 && 'is-ready')}>{T.footer(valid, skipped)}</span>
        <Button variant="ghost" onClick={() => navigate(resourcePath(actor.workspaceId, 'leads'))}>
          {L.common.actions.cancel}
        </Button>
        <Button variant="primary" icon="download" loading={busy} disabledReason={!valid ? T.noValid : !eventName.trim() ? T.enterEvent : undefined} onClick={doImport}>
          {A.importCount(valid)}
        </Button>
      </div>
    </div>
  );
}

/** One numbered step: circle + title + hint on the left of the header, optional tools on the right, content below. */
function ImportStep({ n, title, hint, done, aside, children }: { n: number; title: string; hint: string; done: boolean; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel imp-step" aria-labelledby={`imp-step-${n}`}>
      <header className="imp-step-head">
        <span className={cx('imp-step-num', done && 'is-done')} aria-hidden="true">
          {done ? <Icon name="check" size={14} /> : n}
        </span>
        <div className="imp-step-text">
          <h2 className="imp-step-title" id={`imp-step-${n}`}>
            {title}
          </h2>
          <p className="imp-step-hint">{hint}</p>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
