-- =====================================================================
-- Starter services. Prices are intentionally EMPTY (price = null shows
-- "Price on request" on the site). Set real prices in the admin dashboard.
-- Safe to re-run.
-- =====================================================================
insert into public.services (slug, category, title_ar, title_fr, title_en, description_ar, description_fr, description_en, sort_order)
values
 ('visa-consulting', 'visa',
  'استشارات التأشيرة', 'Conseil visa', 'Visa consulting',
  'دراسة ملفك وتحديد نوع التأشيرة المناسبة، وتجهيز قائمة الوثائق خطوة بخطوة.',
  'Analyse de votre dossier, choix du bon type de visa et liste de documents étape par étape.',
  'We review your profile, choose the right visa type and prepare a step-by-step document checklist.', 1),
 ('appointment-assistance', 'appointment',
  'المساعدة في حجز الموعد', 'Aide à la prise de rendez-vous', 'Visa appointment assistance',
  'مساعدة في حجز موعد القنصلية أو مركز التأشيرات ومراجعة الملف قبل الموعد.',
  'Aide à la réservation du rendez-vous au consulat ou au centre de visas, et vérification du dossier avant le jour J.',
  'Help booking your consulate or visa-centre appointment, and a dossier check before the day.', 2),
 ('e-visa', 'e_visa',
  'التأشيرة الإلكترونية', 'E-visa', 'E-visa services',
  'تقديم طلب التأشيرة الإلكترونية بدقة، مع متابعة الطلب حتى صدوره.',
  'Dépôt précis de votre demande de e-visa, avec suivi jusqu’à la délivrance.',
  'Accurate e-visa applications, tracked until a decision is issued.', 3),
 ('transit-airport', 'transit',
  'استشارات العبور والمطار', 'Conseil transit et aéroport', 'Transit & airport consulting',
  'تحقق من شروط العبور وتأشيرات الترانزيت لتجنب الرفض عند نقطة الدخول أو المطار.',
  'Vérification des conditions de transit et des visas de correspondance pour éviter un refus à l’aéroport.',
  'Check transit conditions and connection visas to avoid refusal at the airport.', 4),
 ('european-trips', 'european_trip',
  'رحلات أوروبية منظمة', 'Voyages organisés en Europe', 'Organised European trips',
  'برامج سفر منظمة إلى أجمل الوجهات الأوروبية مع تنسيق الإجراءات والتأشيرة.',
  'Programmes de voyage organisés vers les plus belles destinations européennes, avec coordination des formalités et du visa.',
  'Organised itineraries to Europe’s most beautiful destinations, with visa and travel coordination.', 5),
 ('travel-consultation', 'consultation',
  'استشارة سفر شخصية', 'Consultation voyage personnalisée', 'Personal travel consultation',
  'جلسة استشارية لتخطيط سفرك وفهم متطلبات الوجهة التي تختارها.',
  'Séance de conseil pour planifier votre voyage et comprendre les exigences de votre destination.',
  'A consultation to plan your trip and understand the requirements of your chosen destination.', 6)
on conflict (slug) do nothing;
