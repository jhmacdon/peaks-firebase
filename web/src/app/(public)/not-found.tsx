import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6">
      <h2 className="text-lg font-semibold mb-2">Page not found</h2>
      <p className="text-sm text-gray-500 mb-4">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/discover"
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        Go to Discover
      </Link>
    </div>
  );
}
