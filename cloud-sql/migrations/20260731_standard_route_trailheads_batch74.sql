-- Record Gunung Raung's current Level II summit exclusion.
--
-- Keep the reviewed Kalibaru geometry pending until the three-kilometre
-- exclusion around the summit crater is lifted by the volcano authority.

BEGIN;

UPDATE destinations
SET
  metadata = metadata || jsonb_build_object(
    'access_status', 'closed',
    'access_checked_at', '2026-07-31',
    'closure_source_url', 'https://geologi.esdm.go.id/media-center/laporan-khusus-aktivitas-gunungapi-raung-jawa-timur-tanggal-20-juni-2025',
    'closure_reference_url', 'https://www.bintangtenggara.net/banyuwangi/3922852545/pvmbg-gunung-raung-masih-level-ii-pendaki-dilarang-turun-ke-kaldera',
    'access_note', 'Gunung Raung is at Level II. The current volcano-authority recommendation bars activity within three kilometres of the summit crater, which includes the upper Kalibaru route and true summit. Do not use this route while that exclusion remains. Check the latest official Raung status before any trip; registration, a health check, ranger briefing, an expert local guide, and the Wonorejo fee may also apply after reopening.'
  ),
  updated_at = now()
WHERE id = '194DF2D864865A0B8DFE';

COMMIT;
