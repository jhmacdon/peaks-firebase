"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
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
  User,
  IdTokenResult,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          await ensureUserProfile(result.user);
        }
      })
      .catch(() => {
        // Auth state listener below will still reconcile the signed-in user.
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
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const handleSignInWithGoogle = async () => {
    await signInWithProvider(googleProvider);
  };

  const handleSignInWithApple = async () => {
    await signInWithProvider(appleProvider);
  };

  const createAccount = async (email: string, password: string, displayName: string) => {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName });
    await setDoc(doc(db, "users", result.user.uid), {
      name: displayName,
      email,
      createdAt: new Date().toISOString(),
    });
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const signOut = async () => {
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
    await ensureUserProfile(result.user);
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
