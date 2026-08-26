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
    title: "Track list progress",
    body: "See how far you are through peak lists and destination collections.",
  },
  {
    title: "Save route context",
    body: "Keep routes and destination guides tied to your profile.",
  },
  {
    title: "Publish useful reports",
    body: "Share photos and field notes that help the next person prepare.",
  },
];

export default function RegisterPage() {
  return (
    <AuthProvider>
      <AppNav />
      <div className="pb-[var(--chrome-bottom-h)] md:pb-0">
        <Suspense fallback={<AuthPageFallback />}>
          <RegisterContent />
        </Suspense>
      </div>
    </AuthProvider>
  );
}

function RegisterContent() {
  const { createAccount, signInWithGoogle, signInWithApple, user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const next = safeNextPath(searchParams.get("next"));

  const loginHref = useMemo(
    () => `/login${next !== "/discover" ? `?next=${encodeURIComponent(next)}` : ""}`,
    [next]
  );

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, next, router, user]);

  if (!loading && user) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    if (!email.trim()) {
      setError("Enter your email.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await createAccount(email, password, name);
      router.replace(next);
    } catch (caught: unknown) {
      const firebaseError = caught as { code?: string };
      setError(
        firebaseError?.code === "auth/email-already-in-use"
          ? "An account with this email already exists."
          : "Registration failed. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    try {
      await signInWithGoogle();
    } catch {
      setError("Google sign-in failed.");
    }
  };

  const handleApple = async () => {
    setError("");
    try {
      await signInWithApple();
    } catch {
      setError("Apple sign-in failed.");
    }
  };

  return (
    <AuthShell
      eyebrow="Build your outdoor profile"
      title="Keep lists, routes, maps, and field notes with you."
      body="Save destinations, log completed outings, and keep route tools in one place."
      features={FEATURES}
      formTitle="Create your account"
      formBody="Start tracking your mountain history with email, Google, or Apple."
    >
      <OAuthButtons onGoogle={handleGoogle} onApple={handleApple} />
      <AuthDivider />

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
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
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
          />
          <p className="mt-1.5 text-xs text-muted">
            Use at least 8 characters. You can add profile details later.
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-ctl border border-alert bg-page px-3 py-2 text-sm text-alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <div className="mt-5 flex items-center justify-between gap-4 text-sm text-muted">
        <Link href="/discover" className="hover:text-ink hover:underline">
          Browse first
        </Link>
        <span className="text-right">
          Already have an account?{" "}
          <Link href={loginHref} className="font-medium text-accent-text hover:underline">
            Sign in
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
