"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminBrand } from "../../../components/admin/admin-brand";
import { Button } from "../../../components/ui/button";
import { Input, Label } from "../../../components/ui/field";
import { Spinner } from "../../../components/explore/explore-icons";
import { useAuth } from "../../../lib/auth-context";

export default function LoginPage() {
  const { signIn, user, isAdmin, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const signedInAdmin = Boolean(user?.uid && isAdmin);

  useEffect(() => {
    if (!loading && signedInAdmin) router.replace("/admin");
  }, [loading, router, signedInAdmin]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await signIn(email, password);
      const { auth } = await import("../../../lib/firebase");
      const tokenResult = await auth.currentUser?.getIdTokenResult();
      if (tokenResult?.claims.admin !== true) {
        setError("This account does not have admin access.");
        const { signOut } = await import("firebase/auth");
        await signOut(auth);
      } else {
        router.replace("/admin");
      }
    } catch {
      setError("The email or password is not valid.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!loading && signedInAdmin) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page" role="status">
        <div className="flex items-center gap-3 text-sm text-muted">
          <Spinner />
          <span>Opening admin workspace…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh bg-page lg:grid-cols-[minmax(0,1fr)_minmax(440px,38vw)]">
      <section className="relative hidden overflow-hidden border-r border-border bg-surface p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="relative z-10">
          <AdminBrand />
        </div>

        <svg
          viewBox="0 0 700 700"
          className="pointer-events-none absolute -bottom-24 -right-28 h-[86%] w-auto text-hairline"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path d="M34 628 216 320l142 235 86-142 221 215" />
          <path d="M102 628 287 165l143 318 74-118 161 263" />
          <path d="m222 328 65-163 56 125" />
          <path d="m349 555 81-72 47 53" />
        </svg>

        <div className="relative z-10 max-w-[560px]">
          <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
            Private workspace
          </p>
          <p className="font-display text-[52px] font-[660] leading-[1.05] tracking-[-0.015em] text-ink">
            Manage every peak, path, and climb.
          </p>
          <p className="mt-6 max-w-[48ch] text-ink-2">
            Review catalog details, routes, photos, and recorded activity.
          </p>
        </div>
      </section>

      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-12 lg:hidden">
            <AdminBrand />
          </div>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
              Admin access
            </p>
            <h1 className="mt-3 font-display text-[32px] font-[680] leading-[1.1] tracking-[-0.015em] text-ink sm:text-[40px]">
              Sign in
            </h1>
            <p className="mt-3 text-sm text-ink-2">Use the account with your Peaks admin claim.</p>
          </div>

          <form onSubmit={handleSubmit} className="mt-9 space-y-5">
            <div>
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>

            {error ? <p className="text-sm text-alert" role="alert">{error}</p> : null}

            <Button type="submit" variant="primary" disabled={submitting} className="w-full">
              {submitting ? (
                <>
                  <Spinner />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <Link
            href="/"
            className="mt-8 inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-ink hover:underline"
          >
            Back to Peaks
          </Link>
        </div>
      </main>
    </div>
  );
}
