-- Keep the live Gunung Mulu Park HQ record in step with the current park rules.

BEGIN;

UPDATE destinations
SET metadata = metadata || jsonb_build_object(
      'official_access_url', 'https://mulupark.com/the-summit/',
      'route_reference_url', 'https://www.summitpost.org/gunung-mulu/1021374',
      'access_note', 'The official four-day summit trek begins at Gunung Mulu National Park HQ. Advance booking is required, and the park price includes the required park guide and camp fees. The park sets a minimum booking size of three, a maximum party size of six including guides and porters, and a minimum age of 16. Confirm space, current price, guide and porter plans, park entry, camp condition, food and fuel needs, weather, and any closure with the park before travel. Follow the guide, use the assigned camps, carry all rubbish back to Park HQ, and do not light wood fires outside the Camp 1 fire pit.',
      'hazard_note', 'The park rates this as an extreme 4-day trek. Expect tropical heat and severe humidity, heavy rain, deep mud, slippery roots and rock, stream crossings, steep ladders and fixed ropes, exposed scrambling near the summit, sudden cold, poor visibility, insects, weak phone service, and difficult rescue. Carry all food plus emergency rations, treated water, a sleeping mat and bag, headlamp, rain gear, warm summit layers, sturdy boots, personal medicine, and first aid. Follow the park guide and turn around for flooding, storms, unsafe ropes or ladders, illness, slow progress, or closure.'
    ),
    updated_at = now()
WHERE id = 'E14AC375D3BAA8196F20';

COMMIT;
