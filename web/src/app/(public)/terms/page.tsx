// DRAFT: legal review pending. Standard plain-language draft for an
// activity-tracking app that stores location data — not reviewed by counsel.
import type { Metadata } from "next";
import { absoluteUrl, siteConfig } from "../../../lib/seo";
import { PageHeader } from "../../../components/ui/page-header";

const SUPPORT_EMAIL = "support@getpeaks.app";
const LAST_UPDATED = "August 19, 2026";
const DESCRIPTION = "The terms that cover using the Peaks app and website.";

export const metadata: Metadata = {
  title: "Terms of service",
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/terms") },
  openGraph: {
    title: "Terms of service",
    description: DESCRIPTION,
    url: absoluteUrl("/terms"),
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
    title: "Terms of service",
    description: DESCRIPTION,
    images: [absoluteUrl("/twitter-image")],
  },
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <span
        aria-hidden
        style={{ display: "none" }}
        dangerouslySetInnerHTML={{ __html: "<!-- DRAFT: legal review pending -->" }}
      />

      <PageHeader title="Terms of service" />
      <p className="mt-2 text-sm text-muted">Last updated: {LAST_UPDATED}</p>

      <div className="mt-8 max-w-[68ch] space-y-8 text-[15px] leading-7 text-ink-2">
        <p>
          These terms cover your use of the Peaks app and website. By
          creating an account or using the service, you agree to them.
        </p>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">Using Peaks</h2>
          <p>
            You must be at least 13 years old to create an account.
            You’re responsible for keeping your login credentials secure
            and for the activity on your account.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">Acceptable use</h2>
          <p>
            Don’t use Peaks to harass others, upload content you don’t
            have the right to share, scrape or reverse-engineer the
            service, or interfere with its normal operation. We can
            suspend or terminate accounts that violate these terms.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">Content you submit</h2>
          <p>
            You keep ownership of the photos, trip reports, and other
            content you post. By posting it, you grant Peaks a
            non-exclusive, royalty-free license to store, display, and
            distribute it as part of the service — for example, showing
            your trip report to other users. You’re responsible for making
            sure you have the rights to anything you upload.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">
            Outdoor activity and safety
          </h2>
          <p>
            Peaks is a tracking and reference tool, not a substitute for
            your own judgment, training, or local conditions research.
            Routes, distances, and elevations are provided as a guide and
            may be inaccurate or out of date. Mountain and backcountry
            travel carries real risk — you’re responsible for your own
            safety and decisions.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">No subscriptions today</h2>
          <p>
            Peaks is currently free to use. If that changes, we’ll update
            these terms and tell you before any charges apply.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">
            Disclaimer and limitation of liability
          </h2>
          <p>
            Peaks is provided “as is,” without warranties of any kind. To
            the extent the law allows, Peaks and its operators aren’t
            liable for indirect, incidental, or consequential damages
            arising from your use of the service, including damages
            related to outdoor activity.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">Governing law</h2>
          <p>
            These terms are governed by the laws of{" "}
            <em>[governing law placeholder — jurisdiction to be finalized]</em>,
            without regard to conflict-of-law principles.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">Changes to these terms</h2>
          <p>
            We may update these terms as the service changes. Continued
            use after a change means you accept the new terms.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium text-ink">Contact</h2>
          <p>
            Questions:{" "}
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
