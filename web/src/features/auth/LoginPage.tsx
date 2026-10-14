import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH } from '@flowqa/shared';
import { ErrorBox, Field, IconButton } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { errorMessage } from '@/lib/format';

/**
 * Halaman login. Bila belum ada akun sama sekali, halaman ini menjadi form
 * pembuatan akun admin pertama (tidak ada password bawaan).
 */
export function LoginPage() {
  const { setupRequired, login, setup } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (setupRequired && password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      if (setupRequired) await setup({ name, email, password });
      else await login(email, password);
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
      setConfirm('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card panel" onSubmit={submit} noValidate>
        <div className="auth-logo">
          <img src="/logo.png" alt="Testora — Testing, Without the Complexity." width={260} height={64} />
        </div>

        <h2>{setupRequired ? 'Create the admin account' : 'Sign in'}</h2>
        <p className="muted small" style={{ marginTop: 4 }}>
          {setupRequired
            ? 'No accounts exist yet. The first account you create here can sign in to this Testora server.'
            : 'Use your Testora account to continue.'}
        </p>

        {error && (
          <div className="mb-14">
            <ErrorBox error={error} />
          </div>
        )}

        <div className="grid">
          {setupRequired && (
            <Field label="Name">
              <input
                className="in"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </Field>
          )}
          <Field label="Email">
            <input
              className="in"
              type="email"
              autoComplete={setupRequired ? 'email' : 'username'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus={!setupRequired}
            />
          </Field>
          <Field
            label="Password"
            hint={setupRequired ? `At least ${PASSWORD_MIN_LENGTH} characters.` : undefined}
          >
            <div className="auth-pass">
              <input
                className="in"
                type={showPassword ? 'text' : 'password'}
                autoComplete={setupRequired ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <IconButton
                icon="eye"
                size={16}
                label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((v) => !v)}
              />
            </div>
          </Field>
          {setupRequired && (
            <Field label="Confirm password">
              <input
                className="in"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
          )}
        </div>

        <button
          className="btn primary"
          type="submit"
          style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}
          disabled={busy || !email || !password || (setupRequired && (!name || !confirm))}
        >
          {busy ? 'Please wait…' : setupRequired ? 'Create account & sign in' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
