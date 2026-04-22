"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthProvider } from "../../lib/auth-context";

export default function RegisterPage() {
  return (
    <AuthProvider>
      <Suspense fallback={<AuthPageFallback />}>
        <RegisterContent />
      </Suspense>
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
  const next = searchParams.get("next") || "/discover";

  const loginHref = useMemo(
    () => `/login${next !== "/discover" ? `?next=${encodeURIComponent(next)}` : ""}`,
    [next]
  );

  useEffect(() => {
    if (!loading && user) {
      router.replace(next);
    }
  }, [loading, next, router, user]);

  if (!loading && user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await createAccount(email, password, name);
      router.replace(next);
    } catch (err: unknown) {
      const firebaseErr = err as { code?: string };
      if (firebaseErr?.code === "auth/email-already-in-use") {
        setError("An account with this email already exists.");
      } else {
        setError("Registration failed. Please try again.");
      }
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ecfeff_45%,_#f8fafc)] dark:bg-gray-950">
      <div className="mx-auto grid min-h-screen max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <section className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white/80 px-4 py-1.5 text-sm text-cyan-700 shadow-sm backdrop-blur dark:border-cyan-900 dark:bg-gray-900/80 dark:text-cyan-300">
            Build your outdoor profile
          </div>
          <div className="space-y-4">
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-gray-950 dark:text-white sm:text-5xl">
              Create an account for lists, route beta, maps, and field notes that stay with you.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-gray-600 dark:text-gray-300">
              Save destinations, log completed outings, write trip reports, and keep
              planning tools tied to one place instead of scattered across apps.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Track list progress", "See how far you are through peak lists and destination collections."],
              ["Save route context", "Keep route pages, destination details, and map exploration tied to your profile."],
              ["Publish better beta", "Share photos and trip reports that help the next person plan smarter."],
            ].map(([title, body]) => (
              <div
                key={title}
                className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/80"
              >
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {title}
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="w-full rounded-[28px] border border-white/70 bg-white/90 p-8 shadow-xl backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
          <h2 className="text-2xl font-bold text-gray-950 dark:text-white">
            Create your account
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Start tracking your mountain history with email, Google, or Apple.
          </p>

          <div className="mt-6 space-y-3">
            <button
              onClick={handleGoogle}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 border border-gray-300 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continue with Google
            </button>
            <button
              onClick={handleApple}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 border border-gray-300 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
              Continue with Apple
            </button>
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200 dark:border-gray-700" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-gray-900 px-2 text-gray-500">Or use email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-transparent px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-transparent px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-transparent px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
                required
                minLength={6}
              />
              <p className="mt-1 text-xs text-gray-500">
                Use at least 6 characters. You can add profile details later.
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Creating account..." : "Create Account"}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between gap-4 text-sm text-gray-500">
            <Link href="/discover" className="hover:text-gray-900 dark:hover:text-gray-100">
              Browse first
            </Link>
            <span className="text-right">
              Already have an account?{" "}
              <Link
                href={loginHref}
                className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                Sign in
              </Link>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthPageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-gray-500">Loading...</div>
    </div>
  );
}
