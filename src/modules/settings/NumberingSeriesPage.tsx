/**
 * Settings › Numbering Series (BR-13): prefix, division code, financial year, separator, digits and the
 * next number per document type. Every number generator (quotations, sales orders, leads, opportunities,
 * service tickets) reads these through services/config.nextNumber.
 */
import { useState } from 'react';
import { L } from '../../constants/labels';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { call, errorMessage } from '../../services/api/client';
import { can } from '../../services/authz';
import { DEFAULT_SERIES, DOC_TYPES, type DocType, getNumberSeries, lastIssued, type NumberSeries, previewNumber, saveNumberSeries, validateSeries } from '../../services/config';
import { useActor, useRevision } from '../../services/hooks';
import { Button } from '../../components/primitives/Button';
import { SegmentedControl, Switch, TextField } from '../../components/primitives/controls';
import { ErrorState, NoAccess, useToast } from '../../components/primitives/feedback';
import { confirmAction } from '../../components/primitives/overlay';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { SettingsField, SettingsPage, SettingsSection, SettingsSkeleton } from '../../components/settings/kit';

const NS = L.admin.numbering;
const title = L.nav.pages.numberingSeries.title;

export function NumberingSeriesPage() {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const q = useServiceQuery(() => Object.fromEntries(DOC_TYPES.map((t) => [t, getNumberSeries(t)])) as Record<DocType, NumberSeries>, [actor.user.id]);
  const [doc, setDoc] = useState<DocType>('quotation');
  const [draft, setDraft] = useState<{ doc: DocType; series: NumberSeries; next: string } | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!can(actor, 'config.publish')) return <NoAccess what={NS.noAccessWhat} />;
  if (q.error)
    return (
      <SettingsPage title={title} description={NS.short}>
        <ErrorState title={NS.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </SettingsPage>
    );
  if (!q.data)
    return (
      <SettingsPage title={title} description={NS.short}>
        <SettingsSkeleton sections={2} />
      </SettingsPage>
    );

  const saved = getNumberSeries(doc);
  const work = draft && draft.doc === doc ? draft : { doc, series: saved, next: '' };
  const s = work.series;
  const nextNo = work.next.trim() ? Number(work.next) : null;
  const errors = validateSeries(doc, s, nextNo);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved) || !!work.next.trim();
  const set = (patch: Partial<NumberSeries>) => setDraft({ ...work, series: { ...s, ...patch } });
  const last = lastIssued(doc, 'TX');
  const sample = nextNo ? previewNumber(doc, s).replace(/\d+$/, String(nextNo).padStart(s.padding, '0')) : previewNumber(doc, s);

  const save = () => {
    setTried(true);
    if (Object.keys(errors).length) return;
    confirmAction({
      tone: 'primary',
      title: NS.save,
      message: `${NS.docTypes[doc]}: ${NS.preview} ${sample}`,
      confirmLabel: NS.save,
      onConfirm: async () => {
        setBusy(true);
        try {
          await call(() => saveNumberSeries(actor, doc, s, nextNo));
          toast(NS.saved(NS.docTypes[doc]));
          setDraft(null);
          setTried(false);
        } catch (e) {
          toast(errorMessage(e), 'danger');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <SettingsPage title={title} description={NS.short}>
      <SettingsSection
        title={NS.docTypes[doc]}
        help={NS.sectionHelp}
        actions={
          <>
            <Button variant="ghost" icon="reset" onClick={() => setDraft({ doc, series: { ...DEFAULT_SERIES[doc] }, next: '' })}>
              {NS.reset}
            </Button>
            <Button variant="primary" loading={busy} disabledReason={!dirty ? L.admin.draft.noChanges : undefined} onClick={save}>
              {NS.save}
            </Button>
          </>
        }
      >
        <SettingsField label={NS.docType} htmlFor="ns-doc">
          <SelectMenu
            id="ns-doc"
            label={NS.docType}
            value={doc}
            options={DOC_TYPES.map((t) => ({ value: t, label: NS.docTypes[t] }))}
            onChange={(v) => {
              setDoc(v as DocType);
              setTried(false);
            }}
          />
        </SettingsField>
        <SettingsField label={NS.fields.prefix} htmlFor="ns-prefix" required error={tried ? errors.prefix : undefined}>
          <TextField id="ns-prefix" maxLength={8} value={s.prefix} aria-invalid={(tried && !!errors.prefix) || undefined} onChange={(e) => set({ prefix: e.target.value.toUpperCase() })} />
        </SettingsField>
        <SettingsField label={NS.fields.division}>
          <Switch checked={s.division} onChange={(on) => set({ division: on })} label={NS.divisionOn} />
        </SettingsField>
        <SettingsField label={NS.fields.fy} htmlFor="ns-fy">
          <SelectMenu id="ns-fy" label={NS.fields.fy} value={s.fy} options={(['label', 'code', 'none'] as const).map((v) => ({ value: v, label: NS.fyOptions[v] }))} onChange={(v) => set({ fy: v as NumberSeries['fy'] })} />
        </SettingsField>
        <SettingsField label={NS.fields.separator}>
          <SegmentedControl label={NS.fields.separator} value={s.separator} onChange={(v) => set({ separator: v })} options={(['/', '-'] as const).map((v) => ({ value: v, label: v }))} />
        </SettingsField>
        <SettingsField label={NS.fields.padding} htmlFor="ns-pad" error={tried ? errors.padding : undefined}>
          <TextField id="ns-pad" type="number" min={3} max={8} value={String(s.padding)} onChange={(e) => set({ padding: Number(e.target.value) })} />
        </SettingsField>
        <SettingsField label={NS.fields.nextNumber} htmlFor="ns-next" help={NS.nextHelp(last)} error={tried ? errors.nextNumber : undefined}>
          <TextField id="ns-next" type="number" min={1} inputMode="numeric" value={work.next} onChange={(e) => setDraft({ ...work, next: e.target.value })} />
        </SettingsField>
        <SettingsField label={NS.preview}>
          <code>{sample}</code>
        </SettingsField>
      </SettingsSection>
    </SettingsPage>
  );
}
