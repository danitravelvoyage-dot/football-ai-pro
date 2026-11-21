-- =====================================================================
-- Launch catalogue: the services of the business that seed.sql does not have yet. Requires migration 0020 (the
-- booking and itinerary categories). Prices are intentionally EMPTY ("Price on request"): the owner sets them in the
-- admin dashboard. Safe to re-run: an existing slug is never changed.
--
-- Mapping of the business services to slugs:
--   France visa appointment assistance -> france-visa-appointment (new)
--   Other country visa appointments    -> appointment-assistance (seed.sql)
--   Visa consultation                  -> visa-consulting (seed.sql)
--   Visa application file assistance   -> visa-file-assistance (new)
--   Electronic visas                   -> e-visa (seed.sql)
--   Flight bookings                    -> flight-booking (new)
--   Hotel bookings                     -> hotel-booking (new)
--   Travel itineraries                 -> travel-itinerary (new)
--   Transit and stopover programs      -> transit-airport (seed.sql)
-- seed.sql also has european-trips and travel-consultation. They are not in the business list: the owner can
-- deactivate them in the admin dashboard. This file does not change them.
-- =====================================================================
insert into public.services (slug, category, title_ar, title_fr, title_en, description_ar, description_fr, description_en, sort_order)
values
 ('france-visa-appointment', 'appointment',
  'موعد تأشيرة فرنسا', 'Rendez-vous visa France', 'France visa appointment assistance',
  'مساعدة في حجز موعد طلب تأشيرة فرنسا لدى مركز التأشيرات، وتجهيز الملف قبل الموعد. لا نضمن توفر المواعيد ولا قرار القنصلية.',
  'Aide à la prise de rendez-vous pour le visa France auprès du centre de visas, et préparation du dossier avant le rendez-vous. Ni la disponibilité des créneaux ni la décision du consulat ne sont garanties.',
  'Help booking your France visa appointment at the visa centre, and preparing your file before the day. Slot availability and the consulate''s decision are not guaranteed.', 1),
 ('visa-file-assistance', 'visa',
  'المساعدة في ملف التأشيرة', 'Aide au dossier de visa', 'Visa application file assistance',
  'مراجعة ملفك وترتيب الوثائق وتعبئة الاستمارات حسب متطلبات الوجهة.',
  'Vérification de votre dossier, classement des pièces et remplissage des formulaires selon les exigences de la destination.',
  'We review your file, organise your documents and fill in the forms to the destination''s requirements.', 3),
 ('flight-booking', 'booking',
  'حجز تذاكر الطيران', 'Réservation de vols', 'Flight bookings',
  'البحث عن رحلات مناسبة وحجزها حسب تواريخك وميزانيتك.',
  'Recherche et réservation de vols selon vos dates et votre budget.',
  'We find and book flights that match your dates and budget.', 7),
 ('hotel-booking', 'booking',
  'حجز الفنادق', 'Réservation d’hôtels', 'Hotel bookings',
  'حجز فنادق تناسب رحلتك، مع تأكيد حجز يمكن تقديمه مع ملف التأشيرة عند الحاجة.',
  'Réservation d’hôtels adaptés à votre voyage, avec une confirmation utilisable pour le dossier de visa si nécessaire.',
  'Hotel bookings for your trip, with a confirmation you can add to a visa file when needed.', 8),
 ('travel-itinerary', 'itinerary',
  'برامج السفر', 'Itinéraires de voyage', 'Travel itineraries',
  'إعداد برنامج سفر يومي واضح يشمل التنقلات والإقامة، ويمكن إرفاقه بملف التأشيرة.',
  'Préparation d’un itinéraire jour par jour, avec transports et hébergement, utilisable dans un dossier de visa.',
  'A clear day-by-day itinerary with transport and accommodation, which can go into a visa file.', 9)
on conflict (slug) do nothing;
