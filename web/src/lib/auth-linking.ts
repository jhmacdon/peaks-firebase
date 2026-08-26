const PROVIDER_NAMES: Record<string, string> = {
  "apple.com": "Apple",
  "google.com": "Google",
  password: "email and password",
};

export function providerName(providerId: string): string {
  return PROVIDER_NAMES[providerId] ?? "your existing sign-in method";
}

export function accountLinkMessage(
  email: string,
  pendingProviderId: string,
  existingProviderIds: string[] = []
): string {
  const pending = providerName(pendingProviderId);
  const existing = existingProviderIds
    .filter((providerId) => providerId !== pendingProviderId)
    .map(providerName);
  const instruction = existing.length > 0
    ? `Sign in with ${existing.join(" or ")}`
    : "Sign in with the method you used before";
  return `An account already exists for ${email}. ${instruction}, and Peaks will add ${pending} to the same account.`;
}
