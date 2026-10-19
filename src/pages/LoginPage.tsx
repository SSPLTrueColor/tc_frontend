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

/** Simulated sign-in (COM-01, NFR-07): pick a demo user; Admin and Management confirm a displayed one-time code. */
export function LoginPage() {
  useRevision();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
  const [userId, setUserId] = useState(demoUsers[0].id);
  const [otp, setOtp] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const user = demoUsers.find((u) => u.id === userId)!;
  const role = appRoles.find((r) => r.id === user.roleId)!;

  useEffect(() => {
    document.title = 'Sign in · True Color CRM';
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
            <p className="muted">Sales & Service CRM · prototype</p>
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
                  Sign in as
                </label>
                <InfoTip text="No passwords in this prototype: pick a demo user to see the CRM as their role. Every sign-in is written to the audit log." label="About demo sign-in" />
              </span>
              <SelectMenu
                id="login-user"
                block
                label="Demo user"
                value={userId}
                options={demoUsers.map((u) => ({ value: u.id, label: `${u.name} — ${appRoles.find((r) => r.id === u.roleId)?.label}` }))}
                onChange={(v) => {
                  setUserId(v);
                  setError('');
                }}
              />
            </div>
            <div className="login-user span-all">
              <Avatar name={user.name} size={32} />
              <span>
                <strong>{user.title}</strong>
                <span className="muted small"> · {role.description}</span>
              </span>
            </div>
            {needsOtp(userId) && (
              <InlineAlert tone="info" title="Two-step sign-in">
                {role.label} accounts confirm a one-time code after choosing the user.
              </InlineAlert>
            )}
            {error && (
              <p className="field-error span-all" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="default" loading={busy} className="span-all">
              Continue
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
            <InlineAlert tone="info" title="Simulated one-time code">
              A live system would send this by SMS to {user.name}. Your code is <strong className="mono">{otp}</strong>.
            </InlineAlert>
            <div className="form-field span-all">
              <label className="field-label" htmlFor="login-otp">
                One-time code <span className="req">*</span>
              </label>
              <input id="login-otp" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-invalid={!!error || undefined} autoFocus />
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
                Back
              </Button>
              <Button type="submit" variant="primary" loading={busy} disabledReason={code.length !== 6 ? 'Enter the 6-digit code' : undefined}>
                Verify and sign in
              </Button>
            </div>
          </form>
        )}
        <p className="muted small login-foot">Demo data only · stored in this browser · nothing is sent.</p>
      </div>
    </main>
  );
}
