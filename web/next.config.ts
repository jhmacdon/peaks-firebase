import type { NextConfig } from "next";

function parseFirebaseWebAppConfig(rawConfig: string | undefined) {
  if (!rawConfig) {
    return undefined;
  }

  try {
    return JSON.parse(rawConfig) as Record<string, string>;
  } catch {
    return undefined;
  }
}

const systemFirebaseConfig = parseFirebaseWebAppConfig(
  process.env.FIREBASE_WEBAPP_CONFIG,
);

const publicFirebaseEnv = Object.fromEntries(
  Object.entries({
    NEXT_PUBLIC_FIREBASE_WEBAPP_CONFIG:
      process.env.NEXT_PUBLIC_FIREBASE_WEBAPP_CONFIG ??
      (systemFirebaseConfig
        ? JSON.stringify(systemFirebaseConfig)
        : undefined),
    NEXT_PUBLIC_FIREBASE_API_KEY:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
      systemFirebaseConfig?.apiKey,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
      systemFirebaseConfig?.authDomain,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
      systemFirebaseConfig?.projectId,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
      systemFirebaseConfig?.storageBucket,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??
      systemFirebaseConfig?.messagingSenderId,
    NEXT_PUBLIC_FIREBASE_APP_ID:
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
      systemFirebaseConfig?.appId,
  }).filter(([, value]) => value !== undefined),
);

const nextConfig: NextConfig = {
  env: publicFirebaseEnv,
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
