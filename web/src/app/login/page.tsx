"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppNav from "../../components/app-nav";
import {
  AuthDivider,
  AuthShell,
  OAuthButtons,
} from "../../components/auth/auth-shell";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/field";
import { AuthProvider, useAuth } from "../../lib/auth-context";
import { LOADING_LABEL } from "../../lib/constants";
import { safeNextPath } from "../../lib/safe-next-path";

const FEATURES = [
  {
    title: "Map-first planning",
    body: "Open topo maps, route geometry, and destination details in one place.",
  },
  {
    title: "Trip reports",
    body: "Read field notes from other hikers and publish your own.",
  },
  {
    title: "Progress tracking",
    body: "Keep lists, sessions, and plans tied to your account.",
  },
];

export default function LoginPage() {
  return (
    <AuthProvider>
      <AppNav />
      <div className="pb-[var(--chrome-bottom-h)] md:pb-0">
        <Suspense fallback={<AuthPageFallback />}>
          <LoginContent />
        </Suspense>
      </div>
    </AuthProvider>
  );
}

function LoginContent() {
  const {
    signIn,
    signInWithGoogle,
    signInWithApple,
    resetPassword,
    user,
    loading,
  } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const next = safeNextPath(searchParams.get("next"));

  const registerHref = useMemo(
    () => `/register${next !== "/discover" ? `?next=${encodeURIComponent(next)}` : ""}`,
    [next]
  );

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, next, router, user]);

  if (!loading && user) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setResetMessage("");
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.replace(next);
    } catch {
      setError("Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    setResetMessage("");
    try {
      await signInWithGoogle();
    } catch {
      setError("Google sign-in failed.");
    }
  };

  const handleApple = async () => {
    setError("");
    setResetMessage("");
    try {
      await signInWithApple();
    } catch {
      setError("Apple sign-in failed.");
    }
  };

  const handlePasswordReset = async () => {
    setError("");
    setResetMessage("");
    if (!email.trim()) {
      setError("Enter your email first and we’ll send you a reset link.");
      return;
    }
    try {
      await resetPassword(email.trim());
      setResetMessage("Password reset email sent. Check your inbox and spam folder.");
    } catch {
      setError("Couldn’t send a reset email. Check the address and try again.");
    }
  };

  return (
    <AuthShell
      eyebrow="Built for serious mountain progress"
      title="Keep your routes, reports, and summit progress in one place."
      body="Jump back into saved plans, log new outings, and track the lists you’re chasing."
      features={FEATURES}
      formTitle="Sign in to Peaks"
      formBody="Pick up where you left off and keep your mountain history synced."
    >
      <OAuthButtons onGoogle={handleGoogle} onApple={handleApple} />
      <AuthDivider />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="password">Password</Label>
            <button
              type="button"
              onClick={handlePasswordReset}
              className="mb-1.5 text-sm font-medium text-accent-text hover:underline"
            >
              Forgot password?
            </button>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-ctl border border-alert bg-page px-3 py-2 text-sm text-alert">
            {error}
          </p>
        ) : null}
        {resetMessage ? (
          <p role="status" className="rounded-ctl border border-success bg-page px-3 py-2 text-sm text-success">
            {resetMessage}
          </p>
        ) : null}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="mt-5 flex items-center justify-between gap-4 text-sm text-muted">
        <Link href="/discover" className="hover:text-ink hover:underline">
          Continue browsing
        </Link>
        <span className="text-right">
          New here?{" "}
          <Link href={registerHref} className="font-medium text-accent-text hover:underline">
            Create an account
          </Link>
        </span>
      </div>
    </AuthShell>
  );
}

function AuthPageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page">
      <div className="text-muted">{LOADING_LABEL}</div>
    </div>
  );
}
