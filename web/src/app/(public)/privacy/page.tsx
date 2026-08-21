// DRAFT: legal review pending. Standard plain-language draft for an
// activity-tracking app that stores location data — not reviewed by counsel.
import type { Metadata } from "next";
import { absoluteUrl, siteConfig } from "../../../lib/seo";
import { PageHeader } from "../../../components/ui/page-header";

const SUPPORT_EMAIL = "support@getpeaks.app";
const LAST_UPDATED = "August 19, 2026";
const DESCRIPTION =
  "What Peaks collects, how it's stored, and how to delete your data.";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/privacy") },
  openGraph: {
    title: "Privacy policy",
    description: DESCRIPTION,
    url: absoluteUrl("/privacy"),
    siteName: siteConfig.name,
    images: [
      {
        url: absoluteUrl("/opengraph-image"),
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Privacy policy",
    description: DESCRIPTION,
    images: [absoluteUrl("/twitter-image")],
  },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      {/* Rendered marker, not just a source comment — matches the task's
          "begin the page with an HTML comment" instruction so the draft
          status is visible in the served markup, not only in source. */}
      <span
        aria-hidden
        style={{ display: "none" }}
        dangerouslySetInnerHTML={{ __html: "<!-- DRAFT: legal review pending -->" }}
      />

      <PageHeader title="Privacy policy" />
      <p className="mt-2 text-sm text-muted">Last updated: {LAST_UPDATED}</p>

      <div className="mt-8 max-w-[68ch] space-y-8 text-[15px] leading-7 text-ink-2">
        <p>
          Peaks (the app and this site) is a peak-bagging tracker and
          guidebook. This page explains what data we collect, why, and how
          you can control it. It’s written in plain language on purpose —
          if anything is unclear, email us and we’ll fix it.
        </p>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">Data we collect</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium text-ink">Account info</span> —
              your email address, display name, and, if you add one, an
              avatar photo.
            </li>
            <li>
              <span className="font-medium text-ink">Location and activity data</span>{" "}
              — GPS tracks, elevation, timestamps, and route details for
              the sessions you record.
            </li>
            <li>
              <span className="font-medium text-ink">Photos</span> — photos
              you attach to a session or a trip report.
            </li>
            <li>
              <span className="font-medium text-ink">Usage data</span> —
              pages you visit and basic device/browser information,
              collected automatically to keep the service running and find
              bugs.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">How we store it</h2>
          <p>
            Your data lives on Google Cloud and Firebase infrastructure —
            Cloud SQL, Firestore, and Firebase Storage. We use standard
            access controls and encrypt data in transit. No system is
            perfectly secure, but we don’t sell or rent your data to
            anyone.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">Sharing</h2>
          <p>
            We don’t share your personal data with advertisers or data
            brokers. The only parties who see it are the service providers
            that run our infrastructure (Google Cloud, Firebase) and, if
            you choose to write a public trip report or make your profile
            visible, other Peaks users. If you connect a third-party
            service — Strava, for example — we share only what that
            connection requires.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">Retention and deletion</h2>
          <p>
            We keep your data for as long as your account is active. You
            can delete your account at any time from Account settings,
            which removes your profile, sessions, and photos. You can also
            request deletion by emailing us — see Contact below. Some
            records may be kept briefly for backups and fraud prevention
            before they’re purged.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">Children’s privacy</h2>
          <p>
            Peaks isn’t directed at children under 13, and we don’t
            knowingly collect data from them.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">Changes to this policy</h2>
          <p>
            We may update this policy as the app changes. We’ll update the
            “last updated” date above when we do.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">Contact</h2>
          <p>
            Questions or deletion requests:{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-medium text-accent-text hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
