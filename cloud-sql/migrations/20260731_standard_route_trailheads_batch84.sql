-- Add the landowner permission rule for Te Ara ki Hikurangi.

BEGIN;

UPDATE destinations
SET metadata = metadata || jsonb_build_object(
      'landowner_permission_url', 'https://www.maungahikurangi.com/faq',
      'access_note', 'Te Ara ki Hikurangi starts at the formal car park before the bridge onto Pakihiroa Station. Te Rūnanganui o Ngāti Porou requires walkers to obtain permission before using the public walking track; request it through info@maungahikurangi.com. A guide is strongly advised but not required for walkers. There is no public vehicle access past the car park, and private vehicles need prior authorisation for the farm track. The route crosses private working farmland and may close for farming or cultural reasons. DOC lists annual closures from 14 September through 16 October for lambing and from noon on 31 December through noon on 1 January for the Hikurangi Maunga Dawn Event. Check the live DOC alert and current permission before travel, leave gates as found, keep clear of stock, and do not enter during a closure. Camping is not allowed. Dogs, guns, and mountain bikes are not allowed on Pakihiroa Station. Book Hikurangi Hut through Te Rūnanganui o Ngāti Porou if staying overnight.'
    ),
    updated_at = now()
WHERE id = '19923BB8275BD9BBC83B';

COMMIT;
