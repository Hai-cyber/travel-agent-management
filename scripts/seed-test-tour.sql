-- Seed main BEST OF VIETNAM tour
UPDATE tours SET content_data = json_set(
  coalesce(content_data,'{}'),
  '$.highlights', json('["Saigonese life in the morning","Cu Chi tunnels","Jeep tour through city center by night","Life on water in Mekong Delta","Ancient town of Hoi An lantern festival","Imperial citadel of Hue","Sapa hilltribe culture and mountain treks","Ha Long Bay overnight cruise"]'),
  '$.includes', json('["Private air-conditioned vehicle","English-speaking guide throughout","All entrance fees as per itinerary","19 nights accommodation 4-5 star hotels","Daily breakfast plus selected meals","All domestic flights","Welcome and farewell dinners","Ha Long Bay 2-day cruise"]'),
  '$.excludes', json('["International flights","Vietnam visa fees","Travel insurance","Personal expenses and tips","Meals not mentioned in itinerary","Optional activities"]'),
  '$.hotel_cards', json('[{"name":"Hotel des Arts Saigon","location":"Ho Chi Minh City","nights":2,"category":"5-star Boutique"},{"name":"Anantara Hoi An Resort","location":"Hoi An","nights":3,"category":"5-star Resort"},{"name":"La Residence Hue Hotel","location":"Hue","nights":2,"category":"5-star Heritage"},{"name":"Topas Ecolodge","location":"Sapa","nights":3,"category":"Luxury Ecolodge"},{"name":"Paradise Elegance Cruise","location":"Ha Long Bay","nights":2,"category":"5-star Cruise"}]')
) WHERE id = 'wHlfSNDC4vYdDM3c3Ir-a';

-- Seed copy tour (the one the user is testing)
UPDATE tours SET content_data = json_set(
  coalesce(content_data,'{}'),
  '$.highlights', json('["Saigonese life in the morning","Cu Chi tunnels by Jeep at night","Life on water in Mekong Delta","Ancient charm of Hoi An Old Town","Imperial citadel of Hue","Sapa hilltribe culture and mountain treks","Ha Long Bay overnight cruise"]'),
  '$.includes', json('["Private air-conditioned vehicle","English-speaking guide throughout","All entrance fees as per itinerary","8 nights accommodation in selected hotels","Daily breakfast and selected meals","Boat trips and transfers as mentioned"]'),
  '$.excludes', json('["International flights","Vietnam visa fees","Travel insurance","Personal expenses and tips","Meals not mentioned"]'),
  '$.hotel_cards', json('[{"name":"Hotel des Arts Saigon","location":"Ho Chi Minh City","nights":2,"category":"5-star Boutique"},{"name":"Anantara Hoi An Resort","location":"Hoi An","nights":3,"category":"5-star Resort"},{"name":"La Residence Hue Hotel","location":"Hue","nights":2,"category":"5-star Heritage"}]')
) WHERE id = '6_805S5Bctg_dwDz4M4Jm';
