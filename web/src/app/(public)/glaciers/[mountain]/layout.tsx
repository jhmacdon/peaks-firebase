// Same ISR shape as destinations/[id]/layout.tsx: the empty
// generateStaticParams registers the route for hour-long caching without
// prebuilding any page (and without a database at build time).
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

export default function GlacierMountainLayout({ children }: { children: React.ReactNode }) {
  return children;
}
