"use client";

import type { ReactNode } from "react";

export function AuthShell({
  eyebrow,
  title,
  body,
  features,
  formTitle,
  formBody,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  features: Array<{ title: string; body: string }>;
  formTitle: string;
  formBody: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-[calc(100dvh-var(--chrome-top-h))] bg-page">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-6 py-8 lg:min-h-[calc(100dvh-var(--chrome-h))] lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center lg:py-14">
        <section className="order-2 hidden lg:block">
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted">
            {eyebrow}
          </p>
          <h2 className="font-display mt-5 max-w-[16ch] text-[44px] leading-[1.06] font-[660] tracking-[-0.015em] text-ink">
            {title}
          </h2>
          <p className="mt-5 max-w-[52ch] text-base leading-7 text-ink-2">{body}</p>
          <ul className="mt-9 grid gap-6 sm:grid-cols-3">
            {features.map((feature) => (
              <li key={feature.title}>
                <h2 className="text-[15px] font-medium text-ink">{feature.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="auth-form-title"
          className="order-1 rounded-media border border-border bg-surface p-6 sm:p-8"
        >
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted lg:hidden">
            {eyebrow}
          </p>
          <h1
            id="auth-form-title"
            className="font-display mt-3 text-[32px] leading-tight font-[640] tracking-[-0.015em] text-ink lg:mt-0"
          >
            {formTitle}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">{formBody}</p>
          {children}
        </section>
      </div>
    </main>
  );
}

export function OAuthButtons({
  onGoogle,
  onApple,
}: {
  onGoogle: () => void;
  onApple: () => void;
}) {
  return (
    <div className="mt-6 space-y-3">
      <button
        type="button"
        onClick={onGoogle}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-ctl border border-border bg-page px-4 text-sm font-medium text-ink transition-colors hover:bg-fill"
      >
        <GoogleIcon />
        Continue with Google
      </button>
      <button
        type="button"
        onClick={onApple}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-ctl border border-border bg-page px-4 text-sm font-medium text-ink transition-colors hover:bg-fill"
      >
        <AppleIcon />
        Continue with Apple
      </button>
    </div>
  );
}

export function AuthDivider() {
  return (
    <div className="relative my-6" aria-hidden="true">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-hairline" />
      </div>
      <div className="relative flex justify-center text-xs uppercase tracking-[0.08em]">
        <span className="bg-surface px-2 text-faint">Or use email</span>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
