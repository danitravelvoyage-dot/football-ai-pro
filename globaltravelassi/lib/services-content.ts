import type { Locale } from "@/lib/i18n/config";

/** Fallback copy for each service, from supabase/seed.sql and supabase/seed_catalog.sql. The database row wins when it
 * exists, so an owner's edit is always shown. The fallback keeps the page working before the catalogue is loaded. */
export const serviceFallback: Record<string, { category: string; title: Record<Locale, string>; description: Record<Locale, string> }> = {
  "visa-consulting": {
    "category": "visa",
    "title": {
      "ar": "استشارات التأشيرة",
      "fr": "Conseil visa",
      "en": "Visa consulting"
    },
    "description": {
      "ar": "دراسة ملفك وتحديد نوع التأشيرة المناسبة، وتجهيز قائمة الوثائق خطوة بخطوة.",
      "fr": "Analyse de votre dossier, choix du bon type de visa et liste de documents étape par étape.",
      "en": "We review your profile, choose the right visa type and prepare a step-by-step document checklist."
    }
  },
  "france-visa-appointment": {
    "category": "appointment",
    "title": {
      "ar": "موعد تأشيرة فرنسا",
      "fr": "Rendez-vous visa France",
      "en": "France visa appointment assistance"
    },
    "description": {
      "ar": "مساعدة في حجز موعد طلب تأشيرة فرنسا لدى مركز التأشيرات، وتجهيز الملف قبل الموعد. لا نضمن توفر المواعيد ولا قرار القنصلية.",
      "fr": "Aide à la prise de rendez-vous pour le visa France auprès du centre de visas, et préparation du dossier avant le rendez-vous. Ni la disponibilité des créneaux ni la décision du consulat ne sont garanties.",
      "en": "Help booking your France visa appointment at the visa centre, and preparing your file before the day. Slot availability and the consulate's decision are not guaranteed."
    }
  },
  "appointment-assistance": {
    "category": "appointment",
    "title": {
      "ar": "المساعدة في حجز الموعد",
      "fr": "Aide à la prise de rendez-vous",
      "en": "Visa appointment assistance"
    },
    "description": {
      "ar": "مساعدة في حجز موعد القنصلية أو مركز التأشيرات ومراجعة الملف قبل الموعد.",
      "fr": "Aide à la réservation du rendez-vous au consulat ou au centre de visas, et vérification du dossier avant le jour J.",
      "en": "Help booking your consulate or visa-centre appointment, and a dossier check before the day."
    }
  },
  "visa-file-assistance": {
    "category": "visa",
    "title": {
      "ar": "المساعدة في ملف التأشيرة",
      "fr": "Aide au dossier de visa",
      "en": "Visa application file assistance"
    },
    "description": {
      "ar": "مراجعة ملفك وترتيب الوثائق وتعبئة الاستمارات حسب متطلبات الوجهة.",
      "fr": "Vérification de votre dossier, classement des pièces et remplissage des formulaires selon les exigences de la destination.",
      "en": "We review your file, organise your documents and fill in the forms to the destination's requirements."
    }
  },
  "e-visa": {
    "category": "e_visa",
    "title": {
      "ar": "التأشيرة الإلكترونية",
      "fr": "E-visa",
      "en": "E-visa services"
    },
    "description": {
      "ar": "تقديم طلب التأشيرة الإلكترونية بدقة، مع متابعة الطلب حتى صدوره.",
      "fr": "Dépôt précis de votre demande de e-visa, avec suivi jusqu’à la délivrance.",
      "en": "Accurate e-visa applications, tracked until a decision is issued."
    }
  },
  "flight-booking": {
    "category": "booking",
    "title": {
      "ar": "حجز تذاكر الطيران",
      "fr": "Réservation de vols",
      "en": "Flight bookings"
    },
    "description": {
      "ar": "البحث عن رحلات مناسبة وحجزها حسب تواريخك وميزانيتك.",
      "fr": "Recherche et réservation de vols selon vos dates et votre budget.",
      "en": "We find and book flights that match your dates and budget."
    }
  },
  "hotel-booking": {
    "category": "booking",
    "title": {
      "ar": "حجز الفنادق",
      "fr": "Réservation d’hôtels",
      "en": "Hotel bookings"
    },
    "description": {
      "ar": "حجز فنادق تناسب رحلتك، مع تأكيد حجز يمكن تقديمه مع ملف التأشيرة عند الحاجة.",
      "fr": "Réservation d’hôtels adaptés à votre voyage, avec une confirmation utilisable pour le dossier de visa si nécessaire.",
      "en": "Hotel bookings for your trip, with a confirmation you can add to a visa file when needed."
    }
  },
  "travel-itinerary": {
    "category": "itinerary",
    "title": {
      "ar": "برامج السفر",
      "fr": "Itinéraires de voyage",
      "en": "Travel itineraries"
    },
    "description": {
      "ar": "إعداد برنامج سفر يومي واضح يشمل التنقلات والإقامة، ويمكن إرفاقه بملف التأشيرة.",
      "fr": "Préparation d’un itinéraire jour par jour, avec transports et hébergement, utilisable dans un dossier de visa.",
      "en": "A clear day-by-day itinerary with transport and accommodation, which can go into a visa file."
    }
  },
  "transit-airport": {
    "category": "transit",
    "title": {
      "ar": "استشارات العبور والمطار",
      "fr": "Conseil transit et aéroport",
      "en": "Transit & airport consulting"
    },
    "description": {
      "ar": "تحقق من شروط العبور وتأشيرات الترانزيت لتجنب الرفض عند نقطة الدخول أو المطار.",
      "fr": "Vérification des conditions de transit et des visas de correspondance pour éviter un refus à l’aéroport.",
      "en": "Check transit conditions and connection visas to avoid refusal at the airport."
    }
  }
};

/**
 * Service pages: what each of the nine services includes, and what it does not promise. The business name and the
 * short description come from the database (editable by the owner). This file holds the fixed wording only. It makes
 * no claim about visa outcomes, appointment availability, partnerships or prices.
 */
export interface ServiceCopy {
  includes: string[];
  notIncluded: string[];
}

type Content = Record<Locale, ServiceCopy>;

export const serviceContent: Record<string, Content> = {
  "visa-consulting": {
    en: {
      includes: ["A review of your situation and the visa category that fits it", "A checklist of the documents for your destination, step by step", "Answers to your questions before you apply"],
      notIncluded: ["We do not guarantee that a visa will be granted", "The final decision belongs to the competent authority"],
    },
    fr: {
      includes: ["Analyse de votre situation et de la catégorie de visa adaptée", "Liste des documents pour votre destination, étape par étape", "Réponses à vos questions avant le dépôt"],
      notIncluded: ["Nous ne garantissons pas l’obtention du visa", "La décision finale appartient à l’autorité compétente"],
    },
    ar: {
      includes: ["مراجعة وضعك وتحديد فئة التأشيرة المناسبة له", "قائمة بالوثائق المطلوبة لوجهتك، خطوة بخطوة", "إجابات على أسئلتك قبل التقديم"],
      notIncluded: ["لا نضمن الحصول على التأشيرة", "القرار النهائي بيد الجهة المختصة"],
    },
  },
  "france-visa-appointment": {
    en: {
      includes: ["Help booking an appointment at the France visa application centre", "A check of your file before the appointment day", "Guidance on what to bring to the appointment"],
      notIncluded: ["Appointment availability depends on the centre and is not guaranteed", "We do not guarantee the consulate's decision"],
    },
    fr: {
      includes: ["Aide pour réserver un rendez-vous au centre de demande de visa pour la France", "Vérification de votre dossier avant le jour du rendez-vous", "Conseils sur ce qu’il faut apporter au rendez-vous"],
      notIncluded: ["La disponibilité des créneaux dépend du centre et n’est pas garantie", "Nous ne garantissons pas la décision du consulat"],
    },
    ar: {
      includes: ["المساعدة في حجز موعد لدى مركز طلب تأشيرة فرنسا", "مراجعة ملفك قبل يوم الموعد", "إرشادات حول ما يجب إحضاره إلى الموعد"],
      notIncluded: ["توفر المواعيد يعتمد على المركز، ولا نضمنه", "لا نضمن قرار القنصلية"],
    },
  },
  "appointment-assistance": {
    en: {
      includes: ["Help booking an appointment at a consulate or visa centre of your choice", "A review of your file before the appointment", "Reminders of the documents to bring"],
      notIncluded: ["Appointment slots are set by each consulate or centre and are not guaranteed", "We do not guarantee the decision on your visa"],
    },
    fr: {
      includes: ["Aide pour réserver un rendez-vous dans le consulat ou le centre de visas de votre choix", "Examen de votre dossier avant le rendez-vous", "Rappel des documents à apporter"],
      notIncluded: ["Les créneaux sont fixés par chaque consulat ou centre et ne sont pas garantis", "Nous ne garantissons pas la décision sur votre visa"],
    },
    ar: {
      includes: ["المساعدة في حجز موعد لدى القنصلية أو مركز التأشيرات الذي تختاره", "مراجعة ملفك قبل الموعد", "تذكير بالوثائق الواجب إحضارها"],
      notIncluded: ["المواعيد تحددها كل قنصلية أو مركز، ولا نضمنها", "لا نضمن قرار التأشيرة"],
    },
  },
  "visa-file-assistance": {
    en: {
      includes: ["A review of your documents for completeness and consistency", "Help organising and naming the documents in the right order", "Help filling in the forms, from the information you give us"],
      notIncluded: ["We do not change or invent any information in your documents", "Submission and decisions belong to the authority and the applicant"],
    },
    fr: {
      includes: ["Vérification de la complétude et de la cohérence de vos documents", "Aide à classer et nommer les pièces dans le bon ordre", "Aide au remplissage des formulaires, à partir des informations que vous fournissez"],
      notIncluded: ["Nous ne modifions ni n’inventons aucune information de vos documents", "Le dépôt et les décisions relèvent de l’autorité et du demandeur"],
    },
    ar: {
      includes: ["مراجعة مستنداتك للتأكد من اكتمالها واتساقها", "المساعدة في ترتيب الوثائق وتسميتها بالترتيب الصحيح", "المساعدة في تعبئة الاستمارات بالمعلومات التي تزودنا بها"],
      notIncluded: ["لا نغيّر ولا نختلق أي معلومة في مستنداتك", "الإيداع والقرارات من اختصاص الجهة المختصة ومقدّم الطلب"],
    },
  },
  "e-visa": {
    en: {
      includes: ["Help preparing and submitting an electronic visa application", "Tracking of the application until the authority issues a decision", "Clear information on the fees the official site asks for"],
      notIncluded: ["We are not the official government website", "Processing times and decisions are set by the authority"],
    },
    fr: {
      includes: ["Aide à préparer et déposer une demande de visa électronique", "Suivi de la demande jusqu’à la décision de l’autorité", "Informations claires sur les frais demandés par le site officiel"],
      notIncluded: ["Nous ne sommes pas le site officiel du gouvernement", "Les délais de traitement et les décisions relèvent de l’autorité"],
    },
    ar: {
      includes: ["المساعدة في إعداد طلب التأشيرة الإلكترونية وإيداعه", "متابعة الطلب حتى تُصدر الجهة قرارها", "معلومات واضحة عن الرسوم التي يطلبها الموقع الرسمي"],
      notIncluded: ["لسنا الموقع الحكومي الرسمي", "مدد المعالجة والقرارات تحددها الجهة المختصة"],
    },
  },
  "flight-booking": {
    en: {
      includes: ["A search for flights that match your dates and budget", "Booking done with you, before any commitment", "A booking confirmation sent to you, with the details shown"],
      notIncluded: ["Fares and seats change, and are not guaranteed until booked", "Airline rules for changes and refunds apply as the airline sets them"],
    },
    fr: {
      includes: ["Recherche de vols selon vos dates et votre budget", "Réservation effectuée avec vous, avant tout engagement", "Confirmation de réservation qui vous est envoyée, avec les détails"],
      notIncluded: ["Les tarifs et les places changent et ne sont pas garantis avant la réservation", "Les règles de modification et de remboursement sont celles de la compagnie"],
    },
    ar: {
      includes: ["البحث عن رحلات تناسب تواريخك وميزانيتك", "الحجز يتم معك قبل أي التزام", "تأكيد الحجز يُرسل إليك مع التفاصيل"],
      notIncluded: ["الأسعار والمقاعد تتغير، ولا تُضمن قبل الحجز", "قواعد الشركة الناقلة للتعديل والاسترداد هي ما تحدده الشركة"],
    },
  },
  "hotel-booking": {
    en: {
      includes: ["Accommodation search matched to your travel dates and needs", "A booking confirmation you can add to a visa file when needed", "Help with changes, handled with the hotel"],
      notIncluded: ["Rates and room availability can change until the booking is confirmed", "Cancellation and refund rules are those of the hotel or platform"],
    },
    fr: {
      includes: ["Recherche d’hébergement adapté à vos dates et à vos besoins", "Une confirmation de réservation utilisable dans votre dossier de visa si nécessaire", "Aide pour les modifications, traitées avec l’hôtel"],
      notIncluded: ["Les tarifs et les disponibilités peuvent changer jusqu’à la confirmation", "Les règles d’annulation et de remboursement sont celles de l’hôtel ou de la plateforme"],
    },
    ar: {
      includes: ["البحث عن إقامة تناسب تواريخ سفرك واحتياجاتك", "تأكيد حجز يمكن إرفاقه بملف التأشيرة عند الحاجة", "المساعدة في التعديلات بالتنسيق مع الفندق"],
      notIncluded: ["الأسعار وتوفر الغرف قد يتغيران حتى تأكيد الحجز", "قواعد الإلغاء والاسترداد هي قواعد الفندق أو المنصة"],
    },
  },
  "travel-itinerary": {
    en: {
      includes: ["A day-by-day plan with transport and accommodation", "Practical notes on each destination, from the sources you choose", "A version you can adjust with us"],
      notIncluded: ["Opening hours, prices and entry rules can change: check them before you travel", "We do not guarantee the content of third-party providers"],
    },
    fr: {
      includes: ["Un plan jour par jour, avec transports et hébergement", "Notes pratiques sur chaque destination, à partir des sources que vous choisissez", "Une version que vous pouvez ajuster avec nous"],
      notIncluded: ["Horaires, prix et règles d’entrée peuvent changer : vérifiez-les avant de partir", "Nous ne garantissons pas le contenu des prestataires tiers"],
    },
    ar: {
      includes: ["خطة يومًا بيوم تشمل التنقل والإقامة", "ملاحظات عملية عن كل وجهة من مصادر تختارها", "نسخة يمكنك تعديلها معنا"],
      notIncluded: ["المواقيت والأسعار وشروط الدخول قد تتغير، فتأكد منها قبل السفر", "لا نضمن محتوى مزودي الخدمات الخارجيين"],
    },
  },
  "transit-airport": {
    en: {
      includes: ["Checks of transit conditions and connection visas for your route", "Advice on the documents to carry at the airport", "A written summary of the requirements we found, with the date we checked them"],
      notIncluded: ["Transit rules change, and the authority's current rules always apply", "We do not guarantee that a transit will be accepted"],
    },
    fr: {
      includes: ["Vérification des conditions de transit et des visas de correspondance pour votre itinéraire", "Conseils sur les documents à avoir sur vous à l’aéroport", "Un résumé écrit des exigences trouvées, avec la date de vérification"],
      notIncluded: ["Les règles de transit changent ; celles de l’autorité en vigueur s’appliquent toujours", "Nous ne garantissons pas que le transit sera accepté"],
    },
    ar: {
      includes: ["التحقق من شروط العبور وتأشيرات الترانزيت لمسارك", "نصائح عن الوثائق التي يجب حملها في المطار", "ملخص مكتوب بالمتطلبات التي وجدناها مع تاريخ التحقق"],
      notIncluded: ["قواعد العبور تتغير، وتُطبَّق دائمًا قواعد الجهة المختصة الحالية", "لا نضمن قبول العبور"],
    },
  },
};

/** The nine services of the business, in the order the site lists them. */
export const businessServiceSlugs = Object.keys(serviceContent);

export function contentFor(slug: string, locale: Locale): ServiceCopy | null {
  return serviceContent[slug]?.[locale] ?? null;
}
