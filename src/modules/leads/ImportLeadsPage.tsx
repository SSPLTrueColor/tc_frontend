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
import { PageHeader } from '../../components/shell/PageHeader';
import { L } from '../../constants/labels';

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

  return (
    <div className="page">
      <PageHeader
        title={L.nav.pages.importLeads.title}
        description={T.description}
        actions={
          <>
            <Button icon="download" onClick={() => downloadText(T.templateFile, importTemplateCsv())}>
              {A.downloadTemplate}
            </Button>
            <Button icon="arrow-up" onClick={() => fileRef.current?.click()}>
              {A.chooseCsv}
            </Button>
            <Button
              icon="id-card"
              onClick={() => {
                setRows((r) => [...r, scanVisitingCard()]);
                toast(T.cardRead, 'info');
              }}
            >
              {A.scanCard}
            </Button>
          </>
        }
      />
      <input
        ref={fileRef}
        type="file"
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
      <div className="content-surface">
        {fileError && (
          <InlineAlert tone="danger" title={T.fileErrorTitle}>
            {fileError}
          </InlineAlert>
        )}
        <div className="form-grid">
          <div className="form-field">
            <label className="field-label" htmlFor="imp-event">
              {T.eventName} <span className="req">*</span>
            </label>
            <input id="imp-event" className="input" maxLength={80} placeholder={T.eventPlaceholder} value={eventName} onChange={(e) => setEventName(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="imp-paste">
              {T.paste}
            </label>
            <textarea id="imp-paste" className="input textarea" rows={2} placeholder={T.pastePlaceholder} onBlur={(e) => e.target.value.trim() && load(e.target.value)} />
          </div>
        </div>
        {preview.length ? (
          <>
            <p className="toolbar-count muted">
              {T.summary(preview.length, valid, preview.length - valid)}
            </p>
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th scope="col">{T.cols.line}</th>
                    <th scope="col">{T.cols.company}</th>
                    <th scope="col">{T.cols.contact}</th>
                    <th scope="col">{T.cols.reach}</th>
                    <th scope="col">{T.cols.division}</th>
                    <th scope="col">{T.cols.check}</th>
                    <th scope="col">
                      <span className="sr-only">{T.cols.remove}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i}>
                      <td>{r.line}</td>
                      <td>{r.values.company}</td>
                      <td>{r.values.contact_name}</td>
                      <td>{[r.values.mobile, r.values.email].filter(Boolean).join(' · ')}</td>
                      <td>{r.values.division}</td>
                      <td>
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
                      </td>
                      <td>
                        <Button variant="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                          {A.remove}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <div className="row-gap">
              <Button onClick={() => setRows([])}>{A.clear}</Button>
              <Button
                variant="primary"
                loading={busy}
                disabledReason={!valid ? T.noValid : !eventName.trim() ? T.enterEvent : undefined}
                onClick={async () => {
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
                }}
              >
                {A.importCount(valid)}
              </Button>
            </div>
          </>
        ) : (
          <EmptyState icon="download" title={T.emptyTitle}>
            {T.emptyBody}
          </EmptyState>
        )}
      </div>
    </div>
  );
}
