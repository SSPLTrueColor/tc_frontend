import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { todayKey } from '../../lib/dates';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { call, errorMessage } from '../../services/api/client';
import { previewCsvImport, runCsvImport } from '../../services/api/catalog';
import { can } from '../../services/authz';
import { exportableResources, importableResources, rowsForExport, templateCsv, type ImportPreview, type ImportResult } from '../../services/catalog/importer';
import { downloadText, exportCsv } from '../../services/exporter';
import { useActor } from '../../services/hooks';
import { getPolicies } from '../../services/policies';
import { getResource } from '../../services/registry';
import { displayText } from '../../services/runtime';
import { Button } from '../../components/primitives/Button';
import { EmptyValue } from '../../components/primitives/display';
import { Badge, EmptyState, ErrorState, InlineAlert, NoAccess, Skeleton, useToast } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { PageHeader } from '../../components/shell/PageHeader';

/** FR-125 / FR-136 / ADM-07: CSV templates, validated import with preview, role-restricted and audited export. */
export function ImportExportPage() {
  const actor = useActor();
  const toast = useToast();
  const lists = useServiceQuery(() => ({ importable: importableResources(actor).map((r) => ({ key: r.key, label: r.labelPlural })), exportable: exportableResources(actor).map((r) => ({ key: r.key, label: r.labelPlural })) }), [actor.user.id]);
  const [imp, setImp] = useState('');
  const [exp, setExp] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'' | 'preview' | 'import' | 'export'>('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  if (!can(actor, 'data.export') && !can(actor, 'data.import')) return <NoAccess what="import and export" />;
  const header = <PageHeader title="Import / export" description="Download a CSV template, fill it in Excel and import it. Every row is checked with the same rules as the forms before anything is saved. Imports and exports are written to the audit log." />;
  if (lists.error)
    return (
      <div className="page">
        {header}
        <ErrorState title="Could not load record types" onRetry={lists.retry}>
          {lists.error}
        </ErrorState>
      </div>
    );
  if (!lists.data)
    return (
      <div className="page">
        {header}
        <Skeleton rows={6} />
      </div>
    );
  const { importable, exportable } = lists.data;
  const impKey = imp || importable[0]?.key || '';
  const expKey = exp || exportable[0]?.key || '';
  const valid = preview?.rows.filter((r) => !r.errors.length) ?? [];
  const invalid = preview?.rows.filter((r) => r.errors.length) ?? [];

  const onFile = (f: File) => {
    setError('');
    setResult(null);
    if (f.size > getPolicies().maxFileMb * 1024 * 1024) {
      setError(`The file is larger than ${getPolicies().maxFileMb} MB.`);
      return;
    }
    if (!/\.csv$/i.test(f.name)) {
      setError('Save the sheet as CSV (comma separated) and choose that file.');
      return;
    }
    setBusy('preview');
    f.text()
      .then((text) => previewCsvImport(actor, impKey, text))
      .then(setPreview)
      .catch((e) => {
        setPreview(null);
        setError(errorMessage(e));
      })
      .finally(() => setBusy(''));
  };

  return (
    <div className="page">
      {header}
      <div className="cat-grid">
        <section className="panel">
          <h2 className="panel-title dialog-title-row">
            Import
            <InfoTip text="Dates as DD-MM-YYYY, choices by their label, several values separated by ; and related records by ID or name. Up to 1,000 rows per file." label="About the import format" />
          </h2>
          {!can(actor, 'data.import') || !importable.length ? (
            <InlineAlert tone="info">Your role cannot import records. Ask the CRM administrator.</InlineAlert>
          ) : (
            <div className="cat-stack">
              <div className="form-field">
                <label className="field-label" htmlFor="imp-res">
                  Record type
                </label>
                <SelectMenu
                  id="imp-res"
                  block
                  label="Record type to import"
                  value={impKey}
                  options={importable.map((r) => ({ value: r.key, label: r.label }))}
                  onChange={(v) => {
                    setImp(v);
                    setPreview(null);
                    setResult(null);
                    setError('');
                  }}
                />
              </div>
              <div className="row-gap">
                <Button
                  icon="download"
                  onClick={() => {
                    downloadText(`${impKey}-import-template.csv`, templateCsv(actor, impKey));
                    toast('Template downloaded');
                  }}
                >
                  Download template
                </Button>
                <Button variant="primary" icon="arrow-up" loading={busy === 'preview'} onClick={() => fileRef.current?.click()}>
                  Choose CSV file…
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) onFile(f);
                  }}
                />
              </div>
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </section>
        <section className="panel">
          <h2 className="panel-title dialog-title-row">
            Export
            <InfoTip text="Exports everything your role can see for that record type. Masked and hidden fields stay masked. Each export is audited." label="About export" />
          </h2>
          {!exportable.length ? (
            <InlineAlert tone="info">Your role cannot export records.</InlineAlert>
          ) : (
            <div className="cat-stack">
              <div className="form-field">
                <label className="field-label" htmlFor="exp-res">
                  Record type
                </label>
                <SelectMenu id="exp-res" block label="Record type to export" value={expKey} options={exportable.map((r) => ({ value: r.key, label: r.label }))} onChange={setExp} />
              </div>
              <div>
                <Button
                  icon="download"
                  loading={busy === 'export'}
                  onClick={async () => {
                    setBusy('export');
                    try {
                      const res = getResource(expKey);
                      const csv = await call(() => {
                        const rows = rowsForExport(actor, expKey);
                        const columns = ['id', ...res.fields.filter((f) => f.capabilities.export !== false && f.type !== 'image' && f.type !== 'lineitems').map((f) => f.key)];
                        return { csv: exportCsv(actor, res, rows, columns), n: rows.length };
                      });
                      downloadText(`${expKey}-${todayKey()}.csv`, csv.csv);
                      toast(`Exported ${csv.n} ${res.labelPlural.toLowerCase()}`);
                    } catch (e) {
                      toast(errorMessage(e), 'danger');
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  Export CSV
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>

      {result && (
        <InlineAlert tone={result.failed.length ? 'warning' : 'success'} title={`Imported ${result.created.length} record(s)`}>
          {result.failed.length ? `${result.failed.length} row(s) failed: ${result.failed.slice(0, 3).map((f) => `line ${f.line} — ${f.message}`).join('; ')}` : 'All valid rows were saved.'}{' '}
          {result.created.length > 0 && <Link to={`/${preview?.resource ?? impKey}`}>Open {getResource(preview?.resource ?? impKey).labelPlural.toLowerCase()}</Link>}
        </InlineAlert>
      )}

      {preview && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">
              Preview · {getResource(preview.resource).labelPlural}{' '}
              <Badge tone="success">{valid.length} ready</Badge> {invalid.length > 0 && <Badge tone="danger">{invalid.length} with errors</Badge>}
            </h2>
            <span className="row-gap">
              <Button onClick={() => setPreview(null)}>Discard</Button>
              <Button
                variant="primary"
                loading={busy === 'import'}
                disabledReason={!valid.length ? 'No valid rows to import' : result ? 'Already imported' : undefined}
                onClick={async () => {
                  setBusy('import');
                  try {
                    const r = await runCsvImport(actor, preview);
                    setResult(r);
                    toast(`Imported ${r.created.length} record(s)`, r.failed.length ? 'info' : 'success');
                  } catch (e) {
                    toast(errorMessage(e), 'danger');
                  } finally {
                    setBusy('');
                  }
                }}
              >
                Import {valid.length} valid row(s)
              </Button>
            </span>
          </div>
          {preview.unknownColumns.length > 0 && <InlineAlert tone="warning">Ignored columns: {preview.unknownColumns.join(', ')}.</InlineAlert>}
          {!preview.rows.length ? (
            <EmptyState icon="list" title="No data rows">
              The file only has a header row.
            </EmptyState>
          ) : (
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    {preview.columns
                      .filter((c) => c.field)
                      .map((c) => (
                        <th key={c.header} scope="col">
                          {c.field!.label}
                        </th>
                      ))}
                    <th scope="col">Problems</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 200).map((r) => (
                    <tr key={r.line} className={r.errors.length ? 'cat-row-error' : undefined}>
                      <td>{r.line}</td>
                      {preview.columns
                        .filter((c) => c.field)
                        .map((c) => (
                          <td key={c.header}>{r.values[c.field!.key] === undefined ? <EmptyValue /> : displayText(c.field!, r.values[c.field!.key], actor) || <EmptyValue />}</td>
                        ))}
                      <td className={r.errors.length ? 'cat-errors' : 'muted'}>{r.errors.length ? r.errors.join('; ') : 'Ready'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 200 && <p className="muted small">Showing the first 200 of {preview.rows.length} rows.</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
