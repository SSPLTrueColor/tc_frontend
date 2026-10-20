import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { appRoles, demoUsers, organization } from '../domain/pack';
import { call, errorMessage } from '../services/api/client';
import { useRevision } from '../services/hooks';
import { isSignedIn, needsOtp, startSignIn, verifyOtp } from '../services/session';
import { Button } from '../components/primitives/Button';
import { Avatar, InlineAlert } from '../components/primitives/feedback';
import { InfoTip } from '../components/primitives/InfoTip';
import { SelectMenu } from '../components/primitives/SelectMenu';
import { L } from '../constants/labels';
import { ROUTES } from '../constants/routes';
import { TextField } from '../components/primitives/controls';

const G = L.common.login;
const rolePosition = (roleLabel: string, title: string) => L.common.account.rolePosition(roleLabel, title);

/** Simulated sign-in (COM-01, NFR-07): pick a demo user; Admin and Management confirm a displayed one-time code. */
export function LoginPage() {
  useRevision();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? ROUTES.dashboard;
  const [userId, setUserId] = useState(demoUsers[0].id);
  const [otp, setOtp] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const user = demoUsers.find((u) => u.id === userId)!;
  const role = appRoles.find((r) => r.id === user.roleId)!;

  useEffect(() => {
    document.title = G.docTitle;
  }, []);
  // Already signed in (e.g. back button): go straight to the app.
  useEffect(() => {
    if (isSignedIn()) navigate(from, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (op: () => void) => {
    setBusy(true);
    setError('');
    try {
      await call(op);
      if (isSignedIn()) navigate(from, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-card panel">
        <div className="login-brand">
          <span className="rail-brand" aria-hidden="true">
            <span>{organization.monogram}</span>
          </span>
          <div>
            <h1 className="login-title">{organization.name}</h1>
            <p className="muted">{G.subtitle}</p>
          </div>
        </div>
        {!otp ? (
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => {
                const r = startSignIn(userId);
                if (r.otp) setOtp(r.otp);
              });
            }}
          >
            <div className="form-field span-all">
              <span className="field-label-row">
                <label className="field-label" htmlFor="login-user">
                  {G.signInAs}
                </label>
                <InfoTip text={G.about} label={G.aboutLabel} />
              </span>
              <SelectMenu
                id="login-user"
                block
                label={G.demoUser}
                value={userId}
                options={demoUsers.map((u) => ({ value: u.id, label: G.option(u.name, rolePosition(appRoles.find((r) => r.id === u.roleId)?.label ?? u.roleId, u.title)) }))}
                onChange={(v) => {
                  setUserId(v);
                  setError('');
                }}
              />
            </div>
            <div className="login-user span-all">
              <Avatar name={user.name} size={32} />
              <span>
                <strong>{rolePosition(role.label, user.title)}</strong>
                <span className="muted small"> · {role.description}</span>
              </span>
            </div>
            {needsOtp(userId) && (
              <InlineAlert tone="info" title={G.twoStep}>
                {G.twoStepBody(role.label)}
              </InlineAlert>
            )}
            {error && (
              <p className="field-error span-all" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="default" loading={busy} className="span-all">
              {G.continue}
            </Button>
          </form>
        ) : (
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => verifyOtp(userId, code));
            }}
          >
            <InlineAlert tone="info" title={G.simulatedCode}>
              {G.codeSentPre(user.name)}
              <strong className="mono">{otp}</strong>.
            </InlineAlert>
            <div className="form-field span-all">
              <label className="field-label" htmlFor="login-otp">
                {G.oneTimeCode} <span className="req">*</span>
              </label>
              <TextField id="login-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-invalid={!!error || undefined} autoFocus />
            </div>
            {error && (
              <p className="field-error span-all" role="alert">
                {error}
              </p>
            )}
            <div className="row-gap span-all">
              <Button
                onClick={() => {
                  setOtp(null);
                  setCode('');
                  setError('');
                }}
              >
                {L.common.actions.back}
              </Button>
              <Button type="submit" variant="primary" loading={busy} disabledReason={code.length !== 6 ? G.enterCode : undefined}>
                {G.verify}
              </Button>
            </div>
          </form>
        )}
        <p className="muted small login-foot">{G.foot}</p>
      </div>
    </main>
  );
}
