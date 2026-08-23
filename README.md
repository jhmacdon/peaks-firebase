# Peaks

[Peaks](https://getpeaks.app) is a free-to-download iPhone peak-bagging tracker and public mountain guide. It helps hikers plan routes, record ascents, follow peak lists, and share useful trip reports.

![Mount Rainier in the Peaks peak-bagging guide](web/public/seed/mount-rainier.jpg)

As of August 23, 2026, the Peaks catalog held 82,977 mountain destinations, 3,869 protected areas, 15,447 routes, and 25 curated lists. Those figures come from the production catalog; live totals may rise as the guide grows.

## Explore Peaks

- [Browse the public mountain catalog](https://getpeaks.app/discover)
- [Read the peak-bagging guide](https://getpeaks.app/activities/peak-bagging)
- [Find peaks by state](https://getpeaks.app/peaks)
- [Browse curated peak lists](https://getpeaks.app/lists)
- [Download Peaks from the App Store](https://apps.apple.com/us/app/peaks-track-your-climb/id1497469000)

For a plain product overview, read [Peak-bagging app for iPhone](docs/peak-bagging-app-for-iphone.md).

## Repository

This public repository holds the Peaks web app, catalog API, Firebase functions, database migrations, and support tools. The web app lives in [`web`](web), the PostgreSQL API in [`cloud-sql/api`](cloud-sql/api), and Firebase functions in [`functions`](functions).
