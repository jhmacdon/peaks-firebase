"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import {
  AuthCredential,
  OAuthCredential,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  linkWithCredential,
  fetchSignInMethodsForEmail,
  User,
  IdTokenResult,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { accountLinkMessage } from "./auth-linking";

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  authNotice: string | null;
  clearAuthNotice: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  createAccount: (email: string, password: string, displayName: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  isAdmin: false,
  loading: true,
  authNotice: null,
  clearAuthNotice: () => {},
  signIn: async () => {},
  signInWithGoogle: async () => {},
  signInWithApple: async () => {},
  createAccount: async () => {},
  resetPassword: async () => {},
  signOut: async () => {},
  getIdToken: async () => null,
});

const googleProvider = new GoogleAuthProvider();
const appleProvider = new OAuthProvider("apple.com");
appleProvider.addScope("email");
appleProvider.addScope("name");

const PENDING_LINK_KEY = "peaks.pending-auth-links.v1";
const PENDING_LINK_MAX_AGE_MS = 15 * 60 * 1000;

type StoredPendingLinks = {
  email: string;
  createdAt: number;
  credentials: object[];
};

type AuthErrorWithEmail = FirebaseError & {
  customData: FirebaseError["customData"] & { email?: unknown };
};

export class AccountLinkRequiredError extends Error {
  readonly code = "auth/account-link-required";
}

function readPendingLinks(): StoredPendingLinks | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(PENDING_LINK_KEY) ?? "null");
    if (!value || typeof value.email !== "string" || !Array.isArray(value.credentials) ||
        typeof value.createdAt !== "number" ||
        Date.now() - value.createdAt > PENDING_LINK_MAX_AGE_MS) {
      window.sessionStorage.removeItem(PENDING_LINK_KEY);
      return null;
    }
    const credentials = value.credentials.filter((credential: unknown) => {
      try {
        return Boolean(OAuthProvider.credentialFromJSON(credential as object));
      } catch {
        return false;
      }
    });
    if (credentials.length === 0) {
      window.sessionStorage.removeItem(PENDING_LINK_KEY);
      return null;
    }
    return { ...value, credentials } as StoredPendingLinks;
  } catch {
    window.sessionStorage.removeItem(PENDING_LINK_KEY);
    return null;
  }
}

function writePendingLinks(pending: StoredPendingLinks | null): void {
  if (typeof window === "undefined") return;
  if (!pending || pending.credentials.length === 0) {
    window.sessionStorage.removeItem(PENDING_LINK_KEY);
  } else {
    window.sessionStorage.setItem(PENDING_LINK_KEY, JSON.stringify(pending));
  }
}

function credentialFromError(
  error: FirebaseError,
  provider?: GoogleAuthProvider | OAuthProvider
): OAuthCredential | null {
  if (provider instanceof GoogleAuthProvider) {
    return GoogleAuthProvider.credentialFromError(error);
  }
  return OAuthProvider.credentialFromError(error) ?? GoogleAuthProvider.credentialFromError(error);
}

async function captureAccountConflict(
  caught: unknown,
  provider?: GoogleAuthProvider | OAuthProvider
): Promise<AccountLinkRequiredError | null> {
  const error = caught as AuthErrorWithEmail;
  if (error?.code !== "auth/account-exists-with-different-credential") return null;
  const credential = credentialFromError(error, provider);
  const email = typeof error.customData?.email === "string" ? error.customData.email.trim() : "";
  if (!credential || !email) {
    return new AccountLinkRequiredError(
      "This email already belongs to a Peaks account. Sign in with the method you used before."
    );
  }

  const previous = readPendingLinks();
  const credentials = previous?.email.toLowerCase() === email.toLowerCase()
    ? previous.credentials.filter((stored) => {
        try {
          return OAuthProvider.credentialFromJSON(stored).providerId !== credential.providerId;
        } catch {
          return false;
        }
      })
    : [];
  credentials.push(credential.toJSON());
  writePendingLinks({ email, credentials, createdAt: Date.now() });

  let methods: string[] = [];
  try {
    methods = await fetchSignInMethodsForEmail(auth, email);
  } catch {
    // Email-enumeration protection can hide the existing method. The fallback
    // text still tells the member how to complete the link.
  }
  return new AccountLinkRequiredError(
    accountLinkMessage(email, credential.providerId, methods)
  );
}

async function linkPendingCredentials(user: User): Promise<void> {
  const pending = readPendingLinks();
  if (!pending) return;
  if (!user.email || user.email.toLowerCase() !== pending.email.toLowerCase()) {
    throw new AccountLinkRequiredError(
      `Sign in to the Peaks account for ${pending.email} to finish linking providers.`
    );
  }

  const remaining = [...pending.credentials];
  for (const stored of pending.credentials) {
    const credential: AuthCredential = OAuthProvider.credentialFromJSON(stored);
    try {
      await linkWithCredential(user, credential);
    } catch (caught) {
      const error = caught as { code?: string };
      if (error.code !== "auth/provider-already-linked") throw caught;
    }
    remaining.shift();
    writePendingLinks({ ...pending, credentials: remaining });
  }
}

async function completeAuthenticatedUser(user: User): Promise<void> {
  try {
    await linkPendingCredentials(user);
  } catch (error) {
    // A primary sign-in completes before Firebase links the queued provider.
    // Return to a signed-out state if that second step fails so route guards do
    // not treat a half-finished account link as success.
    await firebaseSignOut(auth);
    throw error;
  }
  await ensureUserProfile(user);
}

export function authErrorMessage(caught: unknown, fallback: string): string {
  const error = caught as { code?: string; message?: string };
  return caught instanceof AccountLinkRequiredError || error?.code === "auth/account-link-required"
    ? error.message ?? fallback
    : fallback;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [redirectLoading, setRedirectLoading] = useState(true);
  const [operationBusy, setOperationBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const loading = authLoading || redirectLoading || operationBusy;

  useEffect(() => {
    mounted.current = true;
    const pending = readPendingLinks();
    if (pending) {
      setAuthNotice(accountLinkMessage(
        pending.email,
        OAuthProvider.credentialFromJSON(pending.credentials[0]).providerId
      ));
    }

    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          await completeAuthenticatedUser(result.user);
          if (mounted.current) setAuthNotice(null);
        }
      })
      .catch(async (caught) => {
        const linkError = await captureAccountConflict(caught);
        if (mounted.current) {
          setAuthNotice(linkError?.message ?? "Sign-in failed. Please try again.");
        }
      })
      .finally(() => {
        if (mounted.current) setRedirectLoading(false);
      });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const tokenResult: IdTokenResult = await firebaseUser.getIdTokenResult();
        setUser(firebaseUser);
        setIsAdmin(tokenResult.claims.admin === true);
      } else {
        setUser(null);
        setIsAdmin(false);
      }
      setAuthLoading(false);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    setOperationBusy(true);
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      await completeAuthenticatedUser(result.user);
      setAuthNotice(null);
    } finally {
      setOperationBusy(false);
    }
  };

  const handleSignInWithGoogle = async () => {
    setOperationBusy(true);
    try {
      await signInWithProvider(googleProvider);
      setAuthNotice(null);
    } catch (caught) {
      const linkError = await captureAccountConflict(caught, googleProvider);
      if (linkError) setAuthNotice(linkError.message);
      throw linkError ?? caught;
    } finally {
      setOperationBusy(false);
    }
  };

  const handleSignInWithApple = async () => {
    setOperationBusy(true);
    try {
      await signInWithProvider(appleProvider);
      setAuthNotice(null);
    } catch (caught) {
      const linkError = await captureAccountConflict(caught, appleProvider);
      if (linkError) setAuthNotice(linkError.message);
      throw linkError ?? caught;
    } finally {
      setOperationBusy(false);
    }
  };

  const createAccount = async (email: string, password: string, displayName: string) => {
    setOperationBusy(true);
    try {
      const pending = readPendingLinks();
      if (pending && pending.email.toLowerCase() !== email.trim().toLowerCase()) {
        throw new AccountLinkRequiredError(
          `Finish linking the Peaks account for ${pending.email} before creating another account.`
        );
      }
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(result.user, { displayName });
      await completeAuthenticatedUser(result.user);
      await setDoc(doc(db, "users", result.user.uid), {
        name: displayName,
        email,
        createdAt: new Date().toISOString(),
      });
      setAuthNotice(null);
    } finally {
      setOperationBusy(false);
    }
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const signOut = async () => {
    writePendingLinks(null);
    setAuthNotice(null);
    await firebaseSignOut(auth);
  };

  const getIdToken = async (): Promise<string | null> => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin,
        loading,
        authNotice,
        clearAuthNotice: () => setAuthNotice(null),
        signIn,
        signInWithGoogle: handleSignInWithGoogle,
        signInWithApple: handleSignInWithApple,
        createAccount,
        resetPassword,
        signOut,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Create Firestore user profile if it doesn't exist (for OAuth sign-ins) */
async function ensureUserProfile(user: User) {
  const { getDoc } = await import("firebase/firestore");
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: user.displayName || "",
      email: user.email || "",
      createdAt: new Date().toISOString(),
    });
  }
}

async function signInWithProvider(provider: GoogleAuthProvider | OAuthProvider) {
  try {
    const result = await signInWithPopup(auth, provider);
    await completeAuthenticatedUser(result.user);
  } catch (error) {
    const firebaseError = error as { code?: string };
    if (
      firebaseError?.code === "auth/popup-blocked" ||
      firebaseError?.code === "auth/operation-not-supported-in-this-environment"
    ) {
      await signInWithRedirect(auth, provider);
      return;
    }

    throw error;
  }
}

export function useAuth() {
  return useContext(AuthContext);
}
