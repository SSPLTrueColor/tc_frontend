import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { L } from '../../constants/labels';
import { resourcePath } from '../../lib/routes';
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
import { Badge, EmptyState, ErrorState, InlineAlert, NoAccess, useToast } from '../../components/primitives/feedback';
import { InfoTip } from '../../components/primitives/InfoTip';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { SettingsPage, SettingsSkeleton } from '../../components/settings/kit';
import { Table } from '../../components/primitives/Table';
import { FileInput } from '../../components/primitives/controls';

const X = L.admin.importExport;

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

  if (!can(actor, 'data.export') && !can(actor, 'data.import')) return <NoAccess what={X.noAccessWhat} />;
  const T = L.nav.pages.bulkImportExport.title;
  if (lists.error)
    return (
      <SettingsPage title={T} description={X.short}>
        <ErrorState title={X.loadError} onRetry={lists.retry}>
          {lists.error}
        </ErrorState>
      </SettingsPage>
    );
  if (!lists.data)
    return (
      <SettingsPage title={T} description={X.short}>
        <SettingsSkeleton sections={2} />
      </SettingsPage>
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
      setError(X.tooLarge(getPolicies().maxFileMb));
      return;
    }
    if (!/\.csv$/i.test(f.name)) {
      setError(X.notCsv);
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
    <SettingsPage title={T} description={X.short}>
      <div className="cat-grid">
        <section className="panel">
          <h2 className="panel-title dialog-title-row">
            {X.import}
            <InfoTip text={X.importTip} label={X.importTipLabel} />
          </h2>
          {!can(actor, 'data.import') || !importable.length ? (
            <InlineAlert tone="info">{X.cannotImport}</InlineAlert>
          ) : (
            <div className="cat-stack">
              <div className="form-field">
                <label className="field-label" htmlFor="imp-res">
                  {L.admin.common.recordType}
                </label>
                <SelectMenu
                  id="imp-res"
                  block
                  label={X.importType}
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
                    toast(X.templateDownloaded);
                  }}
                >
                  {X.downloadTemplate}
                </Button>
                <Button variant="primary" icon="arrow-up" loading={busy === 'preview'} onClick={() => fileRef.current?.click()}>
                  {X.chooseFile}
                </Button>
                <FileInput
                  ref={fileRef}
                  
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
            {X.export}
            <InfoTip text={X.exportTip} label={X.exportTipLabel} />
          </h2>
          {!exportable.length ? (
            <InlineAlert tone="info">{X.cannotExport}</InlineAlert>
          ) : (
            <div className="cat-stack">
              <div className="form-field">
                <label className="field-label" htmlFor="exp-res">
                  {L.admin.common.recordType}
                </label>
                <SelectMenu id="exp-res" block label={X.exportType} value={expKey} options={exportable.map((r) => ({ value: r.key, label: r.label }))} onChange={setExp} />
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
                      toast(X.exported(csv.n, res.labelPlural.toLowerCase()));
                    } catch (e) {
                      toast(errorMessage(e), 'danger');
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  {X.exportCsv}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>

      {result && (
        <InlineAlert tone={result.failed.length ? 'warning' : 'success'} title={X.importedTitle(result.created.length)}>
          {result.failed.length ? X.failedRows(result.failed.length, result.failed.slice(0, 3).map((f) => X.failedLine(f.line, f.message)).join('; ')) : X.allSaved}{' '}
          {result.created.length > 0 && <Link to={resourcePath(actor.workspaceId, preview?.resource ?? impKey)}>{X.openList(getResource(preview?.resource ?? impKey).labelPlural)}</Link>}
        </InlineAlert>
      )}

      {preview && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">
              {X.previewTitle(getResource(preview.resource).labelPlural)}{' '}
              <Badge tone="success">{X.ready(valid.length)}</Badge> {invalid.length > 0 && <Badge tone="danger">{X.withErrors(invalid.length)}</Badge>}
            </h2>
            <span className="row-gap">
              <Button onClick={() => setPreview(null)}>{X.discard}</Button>
              <Button
                variant="primary"
                loading={busy === 'import'}
                disabledReason={!valid.length ? X.noValidRows : result ? X.alreadyImported : undefined}
                onClick={async () => {
                  setBusy('import');
                  try {
                    const r = await runCsvImport(actor, preview);
                    setResult(r);
                    toast(X.imported(r.created.length), r.failed.length ? 'info' : 'success');
                  } catch (e) {
                    toast(errorMessage(e), 'danger');
                  } finally {
                    setBusy('');
                  }
                }}
              >
                {X.importRows(valid.length)}
              </Button>
            </span>
          </div>
          {preview.unknownColumns.length > 0 && <InlineAlert tone="warning">{X.ignoredColumns(preview.unknownColumns.join(', '))}</InlineAlert>}
          {!preview.rows.length ? (
            <EmptyState icon="list" title={X.noRowsTitle}>
              {X.noRowsBody}
            </EmptyState>
          ) : (
            <div className="table-scroll">
              <Table scroll={false}>
                <thead>
                  <tr>
                    <th scope="col">{X.line}</th>
                    {preview.columns
                      .filter((c) => c.field)
                      .map((c) => (
                        <th key={c.header} scope="col">
                          {c.field!.label}
                        </th>
                      ))}
                    <th scope="col">{X.problems}</th>
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
                      <td className={r.errors.length ? 'cat-errors' : 'muted'}>{r.errors.length ? r.errors.join('; ') : X.readyCell}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {preview.rows.length > 200 && <p className="muted small">{X.firstRows(200, preview.rows.length)}</p>}
            </div>
          )}
        </section>
      )}
    </SettingsPage>
  );
}
