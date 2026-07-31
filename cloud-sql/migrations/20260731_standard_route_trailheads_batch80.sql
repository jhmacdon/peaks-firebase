-- Tighten Gerlach normal-route access notes after current TANAP review.

BEGIN;

UPDATE destinations
SET metadata = metadata || jsonb_build_object(
      'registration_status_url', 'https://www.tanap.sk/online-registracia/',
      'access_note', 'The normal-route lollipop starts at Sliezsky Dom. Parking at the hotel is limited to guests, costs a fee, and requires advance confirmation. The hotel can arrange guest transport from its Tatranská Polianka car park; other visitors must reach Sliezsky Dom by an allowed trail or other lawful transport. Most of the summit route is outside marked hiking trails and has OSM foot=permit access. TANAP requires suitable climbing gear, route knowledge, identification, a valid national climbing-association card, and, for lower-difficulty climbing, proof of basic training. TANAP normally also requires online registration; its current registration page says the service is temporarily unavailable and that this duty is not being checked for now, while all other conditions remain in force. The marked approach and return paths used by this route are closed to hikers from November 1 through May 31. The separate winter climbing window does not establish public winter use of the Velická/Batizovská circuit. Check current registration status, climbing periods, seasonal closures, weather, rescue notices, hotel access, and guide rules before travel. Do not enter a closed path.'
    ),
    updated_at = now()
WHERE id = 'B56797F14E6217570842';

COMMIT;
