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

  if (!can(actor, 'leads.import') || !perm(actor, 'leads').create) return <NoAccess what="lead import" />;

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
        title="Import leads"
        description="Exhibition leads from a CSV file (in Excel: File → Save as → CSV). Rows are checked before anything is created; existing companies and contacts are reused and owners are assigned by the assignment rules."
        actions={
          <>
            <Button icon="download" onClick={() => downloadText('lead-import-template.csv', importTemplateCsv())}>
              Download template
            </Button>
            <Button icon="arrow-up" onClick={() => fileRef.current?.click()}>
              Choose CSV file…
            </Button>
            <Button
              icon="id-card"
              onClick={() => {
                setRows((r) => [...r, scanVisitingCard()]);
                toast('Card read (simulated — no OCR in the prototype)', 'info');
              }}
            >
              Scan visiting card
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
          if (f.size > 2 * 1024 * 1024) return setFileError('The file is larger than 2 MB.');
          f.text().then(load);
        }}
      />
      <div className="content-surface">
        {fileError && (
          <InlineAlert tone="danger" title="Could not read the file">
            {fileError}
          </InlineAlert>
        )}
        <div className="form-grid">
          <div className="form-field">
            <label className="field-label" htmlFor="imp-event">
              Exhibition / event name <span className="req">*</span>
            </label>
            <input id="imp-event" className="input" maxLength={80} placeholder="e.g. Gartex Texprocess India 2026" value={eventName} onChange={(e) => setEventName(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="imp-paste">
              Or paste CSV rows
            </label>
            <textarea id="imp-paste" className="input textarea" rows={2} placeholder="company,contact_name,mobile,email,…" onBlur={(e) => e.target.value.trim() && load(e.target.value)} />
          </div>
        </div>
        {preview.length ? (
          <>
            <p className="toolbar-count muted">
              {preview.length} row(s) · {valid} ready · {preview.length - valid} with errors (skipped)
            </p>
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">Company</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Mobile / email</th>
                    <th scope="col">Division</th>
                    <th scope="col">Check</th>
                    <th scope="col">
                      <span className="sr-only">Remove</span>
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
                        {!r.errors.length && !r.warnings.length && <span className="tag tone-success">Ready</span>}
                      </td>
                      <td>
                        <Button variant="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                          Remove
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
              <Button onClick={() => setRows([])}>Clear</Button>
              <Button
                variant="primary"
                loading={busy}
                disabledReason={!valid ? 'No valid rows to import' : !eventName.trim() ? 'Enter the exhibition / event name' : undefined}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const out = await leadsApi.import(actor, preview, eventName);
                    toast(`${out.created.length} lead(s) imported${out.skipped ? `, ${out.skipped} skipped` : ''}`);
                    setRows([]);
                    navigate(resourcePath(actor.workspaceId, 'leads', { view: 'v_leads_by_source' }));
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import {valid} lead(s)
              </Button>
            </div>
          </>
        ) : (
          <EmptyState icon="download" title="No rows yet">
            Choose a CSV file, paste rows or scan a visiting card to preview the import.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
