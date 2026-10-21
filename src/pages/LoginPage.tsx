import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { appRoles, demoUsers, organization } from '../domain/pack';
import { call, errorMessage } from '../services/api/client';
import { useRevision } from '../services/hooks';
import { signInUsers } from '../services/registry';
import { isSignedIn, needsOtp, startSignIn, verifyOtp } from '../services/session';
import { Button } from '../components/primitives/Button';
import { Avatar, InlineAlert } from '../components/primitives/feedback';
import { Icon } from '../components/primitives/Icon';
import { InfoTip } from '../components/primitives/InfoTip';
import { SelectMenu } from '../components/primitives/SelectMenu';
import { L } from '../constants/labels';
import { ROUTES } from '../constants/routes';
import { TextField } from '../components/primitives/controls';
import logoUrl from '../assets/logo-web.png';

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
  const people = signInUsers();
  const user = people.find((u) => u.id === userId) ?? people[0];
  const role = appRoles.find((r) => r.id === user.roleId)!;

  useEffect(() => {
    document.title = G.docTitle;
    // Before sign-in there is no personal theme yet: the sign-in screen is always light (the app shell applies the user's theme after).
    document.documentElement.setAttribute('data-theme', 'light');
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
      <section className="login-hero" aria-hidden="true">
        <div className="login-hero-brand">
          <img src={logoUrl} alt="" className="login-logo" />
        </div>
        <div className="login-hero-body">
          <span className="login-eyebrow">{G.heroEyebrow}</span>
          <h2 className="login-hero-title">{G.heroTitle}</h2>
          <p className="login-hero-text">{G.heroBody}</p>
          <ul className="login-features">
            {G.heroFeatures.map((f) => (
              <li key={f.title}>
                <span className="login-feature-icon">
                  <Icon name={f.icon} size={18} />
                </span>
                <span>
                  <strong>{f.title}</strong>
                  <span>{f.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <span className="login-hero-foot">{G.heroFoot}</span>
      </section>

      <section className="login-side">
        <div className="login-card">
          <div className="login-brand">
            <img src={logoUrl} alt={organization.name} className="login-logo" />
            <span className="login-brand-divider" aria-hidden="true" />
            <div>
              <h1 className="login-title">{organization.name}</h1>
              <p className="muted small">{G.subtitle}</p>
            </div>
          </div>

          {!otp ? (
            <form
              className="login-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => {
                  const r = startSignIn(userId);
                  if (r.otp) setOtp(r.otp);
                });
              }}
            >
              <div className="login-heading">
                <h2>{G.welcome}</h2>
                <p className="muted">{G.welcomeSub}</p>
              </div>
              <div className="form-field">
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
                  options={people.map((u) => ({ value: u.id, label: G.option(u.name, rolePosition(appRoles.find((r) => r.id === u.roleId)?.label ?? u.roleId, u.title)) }))}
                  onChange={(v) => {
                    setUserId(v);
                    setError('');
                  }}
                />
              </div>
              <div className="login-user">
                <Avatar name={user.name} size={40} />
                <span className="login-user-text">
                  <strong>{user.name}</strong>
                  <span className="login-role">{rolePosition(role.label, user.title)}</span>
                  <span className="muted small">{role.description}</span>
                </span>
              </div>
              {needsOtp(userId) && (
                <InlineAlert tone="info" title={G.twoStep}>
                  {G.twoStepBody(role.label)}
                </InlineAlert>
              )}
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" size="default" loading={busy} className="login-submit">
                {G.continue}
              </Button>
            </form>
          ) : (
            <form
              className="login-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => verifyOtp(userId, code));
              }}
            >
              <div className="login-heading">
                <h2>{G.otpHeading}</h2>
                <p className="muted">{G.otpSub(user.name)}</p>
              </div>
              <div className="login-otp-box" aria-label={G.simulatedCode}>
                <span className="muted small">{G.yourCode}</span>
                <strong className="mono login-otp-code">{otp}</strong>
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="login-otp">
                  {G.oneTimeCode} <span className="req">*</span>
                </label>
                <TextField id="login-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-invalid={!!error || undefined} autoFocus />
              </div>
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
              <div className="login-actions">
                <Button
                  onClick={() => {
                    setOtp(null);
                    setCode('');
                    setError('');
                  }}
                >
                  {L.common.actions.back}
                </Button>
                <Button type="submit" variant="primary" loading={busy} disabledReason={code.length !== 6 ? G.enterCode : undefined} className="login-submit">
                  {G.verify}
                </Button>
              </div>
            </form>
          )}
          <p className="muted small login-foot">
            <span className="login-foot-icon">
              <Icon name="lock" size={12} />
            </span>
            {G.foot}
          </p>
        </div>
      </section>
    </main>
  );
}
