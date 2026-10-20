import { EXCEPTION_TONE } from '../../domain/statusTones';
import { Switch } from '../../components/primitives/controls';
import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { L } from '../../constants/labels';
import { ROUTES, toPath } from '../../constants/routes';
import { useServiceQuery } from '../../hooks/useServiceQuery';
import { addDays, formatDate, nowLocal, todayKey } from '../../lib/dates';
import { cx } from '../../lib/format';
import { recordPeekPath, resourcePath } from '../../lib/routes';
import { errorMessage } from '../../services/api/client';
import { fieldApi } from '../../services/api/field';
import { useActor } from '../../services/hooks';
import { activeMasterValues, masterValue } from '../../services/registry';
import { Button } from '../../components/primitives/Button';
import { DatePicker } from '../../components/primitives/DatePicker';
import { Avatar, EmptyState, ErrorState, InlineAlert, Skeleton, StatusChip, Tabs, useToast } from '../../components/primitives/feedback';
import { EmptyValue } from '../../components/primitives/display';
import { InfoTip } from '../../components/primitives/InfoTip';
import { SelectMenu } from '../../components/primitives/SelectMenu';
import { QuickCreateDialog } from '../../components/resource/RecordForm';
import { RecordInspector } from '../../components/resource/RecordInspector';
import { PageHeader } from '../../components/shell/PageHeader';
import { fmtMinutes, getLocation, LocationSourcePicker, OfflineSwitch, PAGE_SIZE, Pager, SearchBox, Stat, time12, useLocationSource, useOfflineState } from './common';
import { Table } from '../../components/primitives/Table';

const T = L.nav.pages;
const FC = L.field.common;
const FA = L.field.actions;

const statusChip = (s: unknown) => {
  const v = masterValue('attendanceStatus', s);
  return v ? <StatusChip label={v.label} tone={v.tone} /> : <EmptyValue />;
};
const notCheckedIn = <StatusChip label={FC.notCheckedIn} tone="neutral" />;
const routeLink = (userId: string, date: string) => toPath(ROUTES.routeMapFor, { userId }, { date });

// ---------------------------------------------------------------- Attendance (Check-in / Check-out) — ATT-01, ATT-02, NFR-19

export function AttendancePage() {
  const P = L.field.pages.attendance;
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const peek = params.get('peek');
  const q = useServiceQuery(() => fieldApi.myDay(actor), [actor.user.id, todayKey()]);
  const [source, setSource] = useLocationSource();
  const [onTour, setOnTour] = useState(false);
  const [selfie, setSelfie] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState<null | 'regularisations' | 'leaves'>(null);
  const { offline, pending } = useOfflineState();

  const act = async (kind: 'in' | 'out') => {
    setBusy(true);
    setError('');
    try {
      const { point, place } = await getLocation(source, actor.staffId);
      const at = nowLocal();
      const r = kind === 'in' ? await fieldApi.checkIn(actor, { at, point, place, source, selfie, onTour }) : await fieldApi.checkOut(actor, { at, point, place, source });
      toast(r.queued ? P.queued(kind) : kind === 'in' ? P.checkedIn(time12(at)) : P.checkedOut(time12(at)), r.queued ? 'info' : 'success');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const header = <PageHeader title={T.attendance.title} description={P.description} />;
  if (q.error)
    return (
      <div className="page">
        {header}
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        {header}
        <Skeleton rows={6} />
      </div>
    );
  const d = q.data;
  const rec = d.record;
  const state = rec?.status === 'leave' && !rec.checkInAt ? 'leave' : !rec?.checkInAt ? 'out' : !rec.checkOutAt ? 'in' : 'done';

  return (
    <div className="page field-page">
      {header}
      {!d.consent && (
        <InlineAlert tone="info" title={P.consentTitle}>
          {P.consentBody}{' '}
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await fieldApi.grantConsent(actor);
                toast(P.consentGiven);
              } catch (e) {
                toast(errorMessage(e), 'danger');
              }
            }}
          >
            {FA.agree}
          </Button>
        </InlineAlert>
      )}
      {offline && (
        <InlineAlert tone="warning" title={P.offlineTitle}>
          {P.offlineBody(pending)}
        </InlineAlert>
      )}
      <section className="panel field-checkin">
        <div className="panel-head">
          <h2 className="panel-title dialog-title-row">
            {formatDate(d.today)}
            <InfoTip text={P.shiftHelp(d.shift.start, d.shift.end, d.shift.graceMin, d.shift.halfDayHours, d.office, d.radiusM)} label={P.shiftHelpLabel} />
          </h2>
          {rec ? statusChip(rec.status) : notCheckedIn}
          <span className="spacer" />
          <OfflineSwitch />
        </div>
        {state === 'leave' ? (
          <p className="muted">{P.onLeave}</p>
        ) : state === 'done' ? (
          <dl className="detail-list">
            <div className="detail-row">
              <dt>{P.checkIn}</dt>
              <dd>
                {time12(rec!.checkInAt)} · {String(rec!.checkInPlace ?? '')}
              </dd>
            </div>
            <div className="detail-row">
              <dt>{P.checkOut}</dt>
              <dd>{time12(rec!.checkOutAt)}</dd>
            </div>
            <div className="detail-row">
              <dt>{P.worked}</dt>
              <dd>
                {fmtMinutes(rec!.workMinutes)}
                {Number(rec!.lateByMin) > 0 && P.lateBy(rec!.lateByMin)}
                {Number(rec!.earlyByMin) > 0 && P.leftEarly(rec!.earlyByMin)}
              </dd>
            </div>
            {rec!.distanceKm !== undefined && rec!.distanceKm !== null && (
              <div className="detail-row">
                <dt>{P.route}</dt>
                <dd>
                  <Link to={routeLink(actor.staffId, d.today)}>{P.travelled(rec!.distanceKm)}</Link>
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <div className="field-checkin-body">
            {state === 'in' && (
              <p>
                {P.checkedInAt} <strong>{time12(rec!.checkInAt)}</strong> · {String(rec!.checkInPlace ?? '')}
                {Number(rec!.lateByMin) > 0 && <span className="text-danger">{P.lateBy(rec!.lateByMin)}</span>}
              </p>
            )}
            <LocationSourcePicker value={source} onChange={setSource} />
            {state === 'out' && (
              <div className="row-gap">
                <Switch checked={onTour} onChange={setOnTour} label={P.onTour} text={P.onTour} />
                <Switch checked={selfie} onChange={setSelfie} label={P.selfieAria} text={P.selfie} />
              </div>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <Button variant="primary" size="default" className="field-big-btn" loading={busy} icon={state === 'out' ? 'door-open' : 'check'} onClick={() => act(state === 'out' ? 'in' : 'out')} disabledReason={!d.consent ? P.consentFirst : undefined}>
              {state === 'out' ? FA.checkIn : FA.checkOut}
            </Button>
          </div>
        )}
      </section>

      <section className="stats" aria-label={P.todayAria}>
        <Stat label={P.visitsToday} value={d.visitsToday} sub={P.visitsTodaySub} to={ROUTES.fieldVisits} />
        <Stat label={P.pendingRegularisations} value={d.pendingRegularisations} to={resourcePath(actor.workspaceId, 'regularisations')} />
      </section>
      <div className="row-gap">
        <Button icon="door-open" onClick={() => navigate(toPath(ROUTES.fieldVisits, {}, { mode: 'checkin' }))}>
          {FA.logVisit}
        </Button>
        <Button icon="calendar-clock" onClick={() => setCreating('regularisations')}>
          {FA.requestRegularisation}
        </Button>
        <Button icon="calendar" onClick={() => setCreating('leaves')}>
          {FA.applyForLeave}
        </Button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">{P.last7}</h2>
        </div>
        {d.recent.length ? (
          
            <Table>
              <thead>
                <tr>
                  <th scope="col">{FC.date}</th>
                  <th scope="col">{FC.status}</th>
                  <th scope="col">{FC.in}</th>
                  <th scope="col">{FC.out}</th>
                  <th scope="col">{FC.worked}</th>
                  <th scope="col">{FC.late}</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">
                      <Link to={recordPeekPath(actor.workspaceId, 'attendance', r.id)}>{formatDate(String(r.date))}</Link>
                    </td>
                    <td>{statusChip(r.status)}</td>
                    <td>{r.checkInAt ? time12(r.checkInAt) : <EmptyValue />}</td>
                    <td>{r.checkOutAt ? time12(r.checkOutAt) : <EmptyValue />}</td>
                    <td>{r.workMinutes !== null && r.workMinutes !== undefined ? fmtMinutes(r.workMinutes) : <EmptyValue />}</td>
                    <td>{Number(r.lateByMin) > 0 ? FC.minutes(r.lateByMin) : r.checkInAt ? <span className="muted">{FC.onTime}</span> : <EmptyValue />}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          
        ) : (
          <EmptyState icon="calendar-clock" title={P.emptyTitle}>
            {P.emptyBody}
          </EmptyState>
        )}
      </section>
      {creating && <QuickCreateDialog open resKey={creating} onClose={() => setCreating(null)} onCreated={() => toast(creating === 'leaves' ? P.leaveApplied : P.regularisationSent)} />}
      {peek && <RecordInspector resKey="attendance" recordId={peek} onClose={() => setParams({})} />}
    </div>
  );
}

// ---------------------------------------------------------------- Team Attendance (ATT-03, ATT-10)

type TeamFilter = 'all' | 'not_checked_in' | string;

export function TeamAttendancePage() {
  const P = L.field.pages.teamAttendance;
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayKey();
  const peek = params.get('peek');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TeamFilter>('all');
  const [page, setPage] = useState(0);
  const q = useServiceQuery(() => fieldApi.teamAttendance(actor, date), [actor.user.id, date]);
  const rows = q.data ?? [];
  const present = rows.filter((r) => r.record?.checkInAt).length;
  const late = rows.filter((r) => Number(r.record?.lateByMin) > 0).length;
  const leave = rows.filter((r) => r.record?.status === 'leave').length;
  const needle = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!needle || String(r.employee.fullName).toLowerCase().includes(needle)) &&
      (status === 'all' || (status === 'not_checked_in' ? !r.record?.checkInAt && r.record?.status !== 'leave' : r.record?.status === status)),
  );
  const pageRows = shown.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const setDate = (v: string) => {
    setPage(0);
    setParams(v !== todayKey() ? { date: v } : {});
  };
  const statusOptions = [{ value: 'all', label: P.allStatuses }, { value: 'not_checked_in', label: P.notCheckedInFilter }, ...activeMasterValues('attendanceStatus').map((v) => ({ value: v.key, label: v.label }))];
  return (
    <div className="page">
      <PageHeader title={T.teamAttendance.title} description={P.description} />
      <div className="toolbar field-toolbar">
        <DatePicker value={date} onChange={(v) => v && setDate(v)} label={FC.date} clearable={false} />
        <Button icon="chevron-left" onClick={() => setDate(addDays(date, -1))}>
          {FA.previousDay}
        </Button>
        <Button iconRight="chevron-right" onClick={() => setDate(addDays(date, 1))} disabledReason={date >= todayKey() ? P.cannotLookAhead : undefined}>
          {FA.nextDay}
        </Button>
        <span className="spacer" />
        <Link to={toPath(ROUTES.exceptionDashboard, {}, { date: date !== todayKey() ? date : undefined })} className="link small">
          {P.exceptionsLink}
        </Link>
      </div>
      {q.error ? (
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      ) : !q.data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <section className="stats" aria-label={P.summaryAria}>
            <Stat label={P.people} value={rows.length} />
            <Stat label={P.checkedIn} value={present} sub={P.notCheckedIn(rows.length - present - leave)} />
            <Stat label={P.late} value={late} />
            <Stat label={P.onLeave} value={leave} />
          </section>
          <div className="toolbar field-toolbar">
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(0);
              }}
              label={FC.search}
              placeholder={FC.searchPlaceholder}
            />
            <SelectMenu
              label={P.statusFilter}
              value={status}
              options={statusOptions}
              onChange={(v) => {
                setStatus(v);
                setPage(0);
              }}
            />
          </div>
          <div className="content-surface">
            {!rows.length ? (
              <EmptyState icon="users" title={P.emptyTitle}>
                {P.emptyBody}
              </EmptyState>
            ) : !shown.length ? (
              <EmptyState icon="search" title={P.noMatchTitle}>
                {P.noMatchBody}
              </EmptyState>
            ) : (
              
                <Table>
                  <thead>
                    <tr>
                      <th scope="col">{FC.person}</th>
                      <th scope="col">{FC.status}</th>
                      <th scope="col">{FC.in}</th>
                      <th scope="col">{FC.out}</th>
                      <th scope="col">{FC.worked}</th>
                      <th scope="col">{FC.lateBy}</th>
                      <th scope="col">{FC.earlyExit}</th>
                      <th scope="col">{FC.place}</th>
                      <th scope="col">{FC.visits}</th>
                      <th scope="col">{FC.route}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(({ employee, record, visits }) => (
                      <tr key={employee.id}>
                        <td>
                          <span className="row-gap">
                            <Avatar name={String(employee.fullName)} size={22} />
                            <span>
                              {String(employee.fullName)}
                              <div className="muted small">{String(employee.designation ?? '')}</div>
                            </span>
                          </span>
                        </td>
                        <td>{record ? statusChip(record.status) : notCheckedIn}</td>
                        <td>
                          {record?.checkInAt ? (
                            <button type="button" className="link" onClick={() => setParams({ ...(params.get('date') ? { date } : {}), peek: record.id })}>
                              {time12(record.checkInAt)}
                            </button>
                          ) : (
                            <EmptyValue />
                          )}
                        </td>
                        <td>{record?.checkOutAt ? time12(record.checkOutAt) : <EmptyValue />}</td>
                        <td>{record?.workMinutes ? fmtMinutes(record.workMinutes) : <EmptyValue />}</td>
                        <td className={cx(Number(record?.lateByMin) > 0 && 'text-danger')}>{Number(record?.lateByMin) > 0 ? FC.minutes(record!.lateByMin) : record?.checkInAt ? <span className="muted">{FC.onTime}</span> : <EmptyValue />}</td>
                        <td>{Number(record?.earlyByMin) > 0 ? FC.minutes(record!.earlyByMin) : <EmptyValue />}</td>
                        <td>{record?.checkInPlace ? String(record.checkInPlace) : <EmptyValue />}</td>
                        <td>{visits}</td>
                        <td>{record?.distanceKm ? <Link to={routeLink(employee.id, date)}>{FC.kmValue(record.distanceKm)}</Link> : <EmptyValue />}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              
            )}
          </div>
          <Pager page={page} total={shown.length} onPage={setPage} />
        </>
      )}
      {peek && <RecordInspector resKey="attendance" recordId={peek} onClose={() => setParams(params.get('date') ? { date } : {})} />}
    </div>
  );
}

// ---------------------------------------------------------------- Exception Dashboard (ATT-10)

type ExTab = 'all' | 'no_check_in' | 'late' | 'early_exit' | 'no_visits';
const EX_TONE: Record<string, 'danger' | 'warning' | 'info'> = EXCEPTION_TONE;

export function ExceptionDashboardPage() {
  const P = L.field.pages.exceptionDashboard;
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayKey();
  const [tab, setTab] = useState<ExTab>('all');
  const [search, setSearch] = useState('');
  const q = useServiceQuery(() => fieldApi.exceptions(actor, date), [actor.user.id, date]);
  const needle = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((r) => (tab === 'all' || r.kind === tab) && (!needle || String(r.employee.fullName).toLowerCase().includes(needle)));
  const count = (k: ExTab) => (q.data ?? []).filter((r) => k === 'all' || r.kind === k).length;
  return (
    <div className="page">
      <PageHeader title={T.exceptionDashboard.title} description={P.description} />
      <div className="toolbar field-toolbar">
        <DatePicker value={date} onChange={(v) => setParams(v && v !== todayKey() ? { date: v } : {})} label={FC.date} clearable={false} />
        <Button icon="chevron-left" onClick={() => setParams({ date: addDays(date, -1) })}>
          {FA.previousDay}
        </Button>
        <SearchBox value={search} onChange={setSearch} label={FC.search} placeholder={FC.searchPlaceholder} />
        <span className="spacer" />
        <Link to={toPath(ROUTES.teamAttendance, {}, { date: date !== todayKey() ? date : undefined })} className="link small">
          {P.teamLink}
        </Link>
      </div>
      <Tabs<ExTab>
        label={P.typeLabel}
        value={tab}
        onChange={setTab}
        tabs={(['all', 'no_check_in', 'late', 'early_exit', 'no_visits'] as ExTab[]).map((id) => ({ id, label: id === 'all' ? P.all : P.kinds[id], count: q.data ? count(id) : undefined }))}
      />
      <div className="content-surface">
        {q.error ? (
          <ErrorState title={P.loadError} onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={6} />
        ) : rows.length ? (
          <ul className="flow-list">
            {rows.map((r, i) => (
              <li key={`${r.employee.id}-${r.kind}-${i}`} className="flow-item">
                <span className={`tag tone-${EX_TONE[r.kind]}`}>{P.kinds[r.kind]}</span>
                <span className="flow-main">
                  <span className="flow-title">{String(r.employee.fullName)}</span>
                  <span className="muted small">
                    {String(r.employee.designation ?? '')} · {r.detail}
                  </span>
                </span>
                {r.kind !== 'no_check_in' && (
                  <Link className="link small" to={routeLink(r.employee.id, date)}>
                    {FA.viewRoute}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="check" title={P.emptyTitle}>
            {P.emptyBody(formatDate(date))}
          </EmptyState>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Route Map (ATT-07, simulated)

/** /route-map: person picker scoped by role. /route-map/:userId: that person's route for a day. */
export function RouteMapPage() {
  const { userId } = useParams();
  return userId ? <RouteForPerson userId={userId} /> : <RoutePeople />;
}

function PersonPicker({ date, value }: { date: string; value?: string }) {
  const P = L.field.pages.routeMap;
  const actor = useActor();
  const navigate = useNavigate();
  const q = useServiceQuery(() => fieldApi.routePeople(actor, date), [actor.user.id, date]);
  return (
    <SelectMenu
      label={P.pickerLabel}
      placeholder={P.pickerPlaceholder}
      searchable
      value={value ?? ''}
      disabled={!q.data}
      options={(q.data ?? []).map((r) => ({ value: r.employee.id, label: String(r.employee.fullName) }))}
      onChange={(v) => navigate(routeLink(v, date))}
    />
  );
}

type RouteSort = 'name' | 'distance';

function RoutePeople() {
  const P = L.field.pages.routeMap;
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayKey();
  const [search, setSearch] = useState('');
  const [withRoute, setWithRoute] = useState(false);
  const [sort, setSort] = useState<RouteSort>('name');
  const [page, setPage] = useState(0);
  const q = useServiceQuery(() => fieldApi.routePeople(actor, date), [actor.user.id, date]);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const needle = search.trim().toLowerCase();
  const shown = all
    .filter((r) => (!needle || String(r.employee.fullName).toLowerCase().includes(needle)) && (!withRoute || r.positions > 1))
    .sort((a, b) => (sort === 'distance' ? (b.distanceKm ?? -1) - (a.distanceKm ?? -1) : String(a.employee.fullName).localeCompare(String(b.employee.fullName))));
  const pageRows = shown.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const header = <PageHeader title={T.routeMap.title} description={P.description} />;
  // Only your own route in scope: go straight to it.
  if (q.data && all.length === 1 && all[0].employee.id === actor.staffId) return <Navigate to={routeLink(actor.staffId, date)} replace />;
  return (
    <div className="page">
      {header}
      <div className="toolbar field-toolbar">
        <PersonPicker date={date} />
        <DatePicker
          value={date}
          onChange={(v) => {
            setPage(0);
            setParams(v && v !== todayKey() ? { date: v } : {});
          }}
          label={FC.date}
          clearable={false}
        />
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          label={FC.search}
          placeholder={FC.searchPlaceholder}
        />
        <Switch checked={withRoute} onChange={(on) => { setWithRoute(on); setPage(0); }} label={P.withRouteOnly} text={P.withRouteOnly} />
        <SelectMenu
          label={P.sortLabel}
          value={sort}
          options={[
            { value: 'name', label: P.sortName },
            { value: 'distance', label: P.sortDistance },
          ]}
          onChange={(v) => setSort(v as RouteSort)}
        />
      </div>
      <div className="content-surface">
        {q.error ? (
          <ErrorState title={P.listError} onRetry={q.retry}>
            {q.error}
          </ErrorState>
        ) : !q.data ? (
          <Skeleton rows={6} />
        ) : !all.length ? (
          <EmptyState icon="map-pin" title={P.emptyTitle}>
            {P.emptyBody}
          </EmptyState>
        ) : !shown.length ? (
          <EmptyState icon="search" title={P.noMatchTitle}>
            {P.noMatchBody}
          </EmptyState>
        ) : (
          
            <Table>
              <thead>
                <tr>
                  <th scope="col">{FC.person}</th>
                  <th scope="col">{FC.status}</th>
                  <th scope="col" className="num">
                    {P.distance}
                  </th>
                  <th scope="col" className="num">
                    {P.stops}
                  </th>
                  <th scope="col">
                    <span className="sr-only">{FA.viewRoute}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.employee.id} className={cx(r.employee.id === actor.staffId && 'is-selected')}>
                    <td>
                      <span className="row-gap">
                        <Avatar name={String(r.employee.fullName)} size={22} />
                        <span>
                          {String(r.employee.fullName)}
                          <div className="muted small">{String(r.employee.designation ?? '')}</div>
                        </span>
                      </span>
                    </td>
                    <td>{r.checkedIn ? <StatusChip label={FC.checkedIn} tone="success" /> : notCheckedIn}</td>
                    <td className="num">{r.distanceKm !== null ? FC.kmValue(r.distanceKm) : <EmptyValue label={P.noRoute} />}</td>
                    <td className="num">{r.positions || <EmptyValue />}</td>
                    <td>
                      <Link className="link small" to={routeLink(r.employee.id, date)}>
                        {FA.viewRoute}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          
        )}
      </div>
      <Pager page={page} total={shown.length} onPage={setPage} />
    </div>
  );
}

function RouteForPerson({ userId }: { userId: string }) {
  const P = L.field.pages.routeMap;
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayKey();
  const q = useServiceQuery(() => fieldApi.route(actor, userId, date), [actor.user.id, userId, date]);
  const header = <PageHeader title={T.routeMap.title} description={P.description} />;
  const toolbar = (
    <div className="toolbar field-toolbar">
      <PersonPicker date={date} value={userId} />
      <DatePicker value={date} onChange={(v) => setParams(v ? { date: v } : {})} label={FC.date} clearable={false} />
      <span className="spacer" />
      <Link className="link small" to={toPath(ROUTES.routeMap, {}, { date: date !== todayKey() ? date : undefined })}>
        {FA.allPeople}
      </Link>
    </div>
  );
  if (q.error)
    return (
      <div className="page">
        {header}
        {toolbar}
        <ErrorState title={P.loadError} onRetry={q.retry}>
          {q.error}
        </ErrorState>
      </div>
    );
  if (!q.data)
    return (
      <div className="page">
        {header}
        {toolbar}
        <Skeleton rows={6} />
      </div>
    );
  const { points, distanceKm, days } = q.data;
  return (
    <div className="page">
      {header}
      {toolbar}
      <section className="panel">
        {points.length > 1 ? (
          <>
            <RouteSvg points={points} />
            <p className="muted small">{P.positions(points.length, distanceKm)}</p>
            <ol className="plain-list">
              {points.map((p, i) => (
                <li key={i} className="small">
                  {i === 0 ? P.stopCheckIn : i === points.length - 1 ? P.stopCheckOut : P.stop(i)} · {p.at ? time12(p.at) : ''} · {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <EmptyState icon="activity" title={P.noRouteTitle}>
            {days.length ? P.pickDay : P.afterCheckOut}
          </EmptyState>
        )}
        {days.length > 0 && (
          <div className="row-gap field-days">
            <span className="muted small">{P.daysWithRoute}</span>
            {days.map((dk) => (
              <Button key={dk} size="compact" variant={dk === date ? 'primary' : 'ghost'} onClick={() => setParams({ date: dk })}>
                {formatDate(dk)}
              </Button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RouteSvg({ points }: { points: { lat: number; lng: number }[] }) {
  const P = L.field.pages.routeMap;
  const W = 640;
  const H = 360;
  const pad = 24;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const [minLat, minLng] = [Math.min(...lats), Math.min(...lngs)];
  const span = Math.max(Math.max(...lats) - minLat, Math.max(...lngs) - minLng, 0.002);
  const x = (lng: number) => pad + ((lng - minLng) / span) * (W - pad * 2);
  const y = (lat: number) => H - pad - ((lat - minLat) / span) * (H - pad * 2);
  const path = points.map((p) => `${x(p.lng).toFixed(1)},${y(p.lat).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="field-route" role="img" aria-label={P.svgLabel(points.length)}>
      <polyline points={path} fill="none" stroke="var(--c-accent, #7c5cff)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(p.lng)} cy={y(p.lat)} r={i === 0 || i === points.length - 1 ? 7 : 5} fill={i === 0 ? 'var(--c-success, #16a34a)' : i === points.length - 1 ? 'var(--c-danger, #dc2626)' : 'var(--s-panel, #fff)'} stroke="var(--c-accent, #7c5cff)" strokeWidth="2" />
          <text x={x(p.lng) + 9} y={y(p.lat) - 9} fontSize="12" fill="currentColor">
            {i === 0 ? P.markerIn : i === points.length - 1 ? P.markerOut : i}
          </text>
        </g>
      ))}
    </svg>
  );
}
