import type { Locale } from "@/lib/i18n/config";

/**
 * Legal and trust pages. They describe what the site does and does not do, and make no claim about visa outcomes,
 * official partnerships, guarantees, success rates or fixed prices. The owner reviews this text before launch (see
 * docs/LAUNCH_CHECKLIST.md). Placeholders in braces are filled from the public configuration, never from user data.
 */
export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalPage {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

export const LEGAL_UPDATED = "2026-11-21";

type Pages = Record<"privacy" | "terms" | "cookies", LegalPage>;

const ar: Pages = {
  privacy: {
    title: "سياسة الخصوصية",
    updated: "آخر تحديث",
    intro: "توضح هذه الصفحة أي معلومات نجمعها عند طلب خدمة من GLOBALTRAVELASSI، ولماذا، ومن يمكنه الاطلاع عليها، وما حقوقك.",
    sections: [
      { heading: "من نحن", paragraphs: ["GLOBALTRAVELASSI موقع ومكتب لمساعدة المسافرين في تجهيز ملفات التأشيرات وتنظيم الرحلات. للتواصل: {contactEmail}."] },
      {
        heading: "المعلومات التي نجمعها",
        paragraphs: [
          "الاسم، البريد الإلكتروني، رقم واتساب، الجنسية، بلد الإقامة، بلد الوجهة، تاريخ السفر إن وُجد، الوضع المهني، تاريخ السفر السابق، والمعلومات الإضافية التي تكتبها في الطلب.",
          "المستندات التي ترفعها إلى مساحة تخزين خاصة.",
          "مصدر الطلب: القناة التي وصلت منها إلى الموقع، مثل إعلان أو رابط يحمل وسم حملة، أو الموقع الذي أحالك. نحفظ اسم القناة فقط، ولا نحفظ عنوانك أو معلومات متصفحك.",
          "سجل إرسال الرسائل الإلكترونية الخاصة بطلبك، لنعرف إن كانت قد وصلت.",
        ],
      },
      {
        heading: "لماذا نستخدم المعلومات",
        paragraphs: ["لتجهيز طلبك ومتابعته، ولتواصل فريقنا معك بخصوصه، ولإرسال الإشعارات المرتبطة بطلبك، ولحماية الموقع من الإساءة والطلبات الآلية، ولفهم القنوات التي تصل منها الطلبات."],
      },
      {
        heading: "من يطّلع على معلوماتك",
        paragraphs: [
          "يطّلع عليها الفريق المخوّل فقط. نستخدم مزودي خدمات لتشغيل الموقع وقاعدة البيانات والتخزين وإرسال البريد، ويقتصر دورهم على تقديم هذه الخدمات.",
          "لا نبيع معلوماتك ولا نشاركها مع معلنين. لا يستخدم الموقع أدوات تتبع إعلانية.",
        ],
      },
      {
        heading: "المستندات",
        paragraphs: ["تُحفظ مستنداتك في مساحة خاصة لا يمكن الوصول إليها إلا عبر حسابك أو من فريق مخوّل، وبروابط صالحة لوقت محدود."],
      },
      {
        heading: "مدة الاحتفاظ",
        paragraphs: ["نحتفظ بالمعلومات طالما كانت لازمة لطلبك، ولأي سجلات يفرض القانون الاحتفاظ بها. يمكنك طلب الحذف، باستثناء ما يجب علينا حفظه."],
      },
      {
        heading: "حقوقك",
        paragraphs: ["يمكنك طلب الاطلاع على معلوماتك وتصحيحها أو حذفها أو الاعتراض على معالجتها، وذلك بمراسلتنا على {contactEmail}، وفق القانون المعمول به."],
      },
      {
        heading: "القرارات الرسمية",
        paragraphs: ["قرارات التأشيرة تصدرها الجهات المختصة وحدها. لا نضمن الموافقة ولا مواعيد القنصليات ولا الحجوزات التي يقدمها مزودون آخرون."],
      },
      {
        heading: "تحديثات هذه السياسة",
        paragraphs: ["قد نحدّث هذه السياسة. يظهر تاريخ آخر تحديث في أعلى الصفحة."],
      },
    ],
  },
  terms: {
    title: "شروط الاستخدام",
    updated: "آخر تحديث",
    intro: "تحكم هذه الشروط استخدامك للموقع وطلب خدماتنا.",
    sections: [
      {
        heading: "طبيعة الخدمة",
        paragraphs: ["نساعد في تجهيز ملفات التأشيرات وتنظيم الرحلات وتقديم الاستشارات. لسنا جهة حكومية ولسنا جزءًا من أي قنصلية أو شركة طيران أو فندق، ولا نملك أي شراكة رسمية معها ما لم نذكر ذلك صراحة."],
      },
      {
        heading: "لا ضمانات",
        paragraphs: ["لا نضمن الحصول على تأشيرة أو موعد أو حجز، ولا نعرض أي نسبة نجاح. القرار النهائي بيد الجهات المختصة ومزودي الخدمات."],
      },
      {
        heading: "الأسعار",
        paragraphs: ["الأسعار تُعرض عند الطلب (السعر عند الطلب). يُؤكد السعر ومحتوى الخدمة كتابيًا قبل أن تلتزم بأي مبلغ."],
      },
      {
        heading: "مسؤوليتك",
        paragraphs: ["أنت مسؤول عن دقة المعلومات والمستندات التي تقدمها، وعن صحة بريدك الإلكتروني ورقم واتساب الذي تزودنا به."],
      },
      {
        heading: "الطلبات والإلغاء",
        paragraphs: ["ينشئ إرسال النموذج طلبًا يظهر في حسابك. يحق لك أو لنا إنهاء الطلب في أي وقت، وتُحدَّد شروط الاسترداد لكل خدمة وتُؤكَّد كتابيًا قبل الالتزام."],
      },
      {
        heading: "التواصل",
        paragraphs: ["التواصل عبر واتساب يتم يدويًا من فريقنا. لا نرسل رسائل واتساب آلية. نرسل إشعارات البريد الإلكتروني المرتبطة بطلبك."],
      },
      {
        heading: "المسؤولية",
        paragraphs: ["بالقدر الذي يسمح به القانون، لا نتحمل مسؤولية قرارات الجهات الرسمية، ولا تأخر أو إلغاء من مزودي الطيران والفنادق والخدمات الأخرى."],
      },
      {
        heading: "التواصل معنا",
        paragraphs: ["للاستفسارات: {contactEmail}، أو عبر واتساب {whatsapp}."],
      },
    ],
  },
  cookies: {
    title: "سياسة ملفات الارتباط",
    updated: "آخر تحديث",
    intro: "نستخدم عددًا قليلًا من ملفات الارتباط. هذه الصفحة تشرحها.",
    sections: [
      {
        heading: "ملفات ضرورية لتسجيل الدخول",
        paragraphs: ["تحفظ ملفات الجلسة من Supabase حالة تسجيل دخولك، وتُحذف عند تسجيل الخروج أو بعد انتهاء صلاحيتها. بدونها لا يعمل تسجيل الدخول."],
      },
      {
        heading: "ملف مصدر الطلب",
        paragraphs: ["عند أول زيارة لك، نحفظ ملفًا باسم gta_lead_source يذكر القناة التي وصلت منها (مثل تيك توك أو إنستغرام أو فيسبوك أو غوغل أو واتساب أو الزيارة المباشرة أو غيرها) وقيمة وسم الحملة إن وُجدت. مدته 30 يومًا، ولا يحمل معلومات شخصية. يساعدنا لنعرف أي قنوات تجلب طلبات فعلية. إن رفضت هذا الملف، يُسجَّل مصدر طلبك كـ\"غير ذلك\" ولن يؤثر ذلك على استخدامك للموقع."],
      },
      {
        heading: "ما لا نستخدمه",
        paragraphs: ["لا نستخدم ملفات إعلانية ولا أدوات تحليل لطرف ثالث تتبع تصفحك عبر المواقع."],
      },
    ],
  },
};

const fr: Pages = {
  privacy: {
    title: "Politique de confidentialité",
    updated: "Dernière mise à jour",
    intro: "Cette page explique les informations que nous recueillons lorsque vous demandez un service GLOBALTRAVELASSI, pourquoi, qui peut y accéder et quels sont vos droits.",
    sections: [
      { heading: "Qui nous sommes", paragraphs: ["GLOBALTRAVELASSI est un site et un bureau d’assistance pour la préparation de dossiers de visa et l’organisation de voyages. Contact : {contactEmail}."] },
      {
        heading: "Les informations que nous recueillons",
        paragraphs: [
          "Nom, e-mail, numéro WhatsApp, nationalité, pays de résidence, pays de destination, date de voyage si elle est connue, situation professionnelle, historique de voyage et informations complémentaires que vous saisissez dans la demande.",
          "Les documents que vous téléversez dans un espace de stockage privé.",
          "La source de la demande : le canal par lequel vous êtes arrivé sur le site, par exemple une publicité, un lien portant une balise de campagne, ou le site qui vous a orienté. Nous ne conservons que le nom du canal, jamais votre adresse IP ni les informations de votre navigateur.",
          "L’historique d’envoi des e-mails relatifs à votre demande, pour savoir s’ils ont bien été remis.",
        ],
      },
      {
        heading: "Pourquoi nous les utilisons",
        paragraphs: ["Pour préparer et suivre votre demande, pour vous contacter à son sujet, pour envoyer les notifications liées à votre demande, pour protéger le site contre les abus et les envois automatisés, et pour comprendre par quels canaux nous recevons des demandes."],
      },
      {
        heading: "Qui peut y accéder",
        paragraphs: [
          "Seul le personnel autorisé. Nous faisons appel à des prestataires pour l’hébergement, la base de données, le stockage et l’envoi d’e-mails ; leur rôle se limite à fournir ces services.",
          "Nous ne vendons pas vos informations et ne les partageons pas avec des annonceurs. Le site n’utilise aucun outil de suivi publicitaire.",
        ],
      },
      { heading: "Documents", paragraphs: ["Vos documents sont conservés dans un espace privé. Seuls votre compte et le personnel autorisé peuvent y accéder, au moyen de liens valables pendant une durée limitée."] },
      { heading: "Durée de conservation", paragraphs: ["Nous conservons les informations aussi longtemps que nécessaire à votre demande, et les registres que la loi nous oblige à garder. Vous pouvez demander leur suppression, à l’exception de ce que nous devons conserver."] },
      { heading: "Vos droits", paragraphs: ["Vous pouvez demander l’accès à vos informations, leur rectification, leur suppression ou vous opposer à leur traitement, en écrivant à {contactEmail}, selon le droit applicable."] },
      { heading: "Décisions officielles", paragraphs: ["Les décisions relatives aux visas sont prises par les autorités compétentes. Nous ne garantissons ni l’obtention d’un visa, ni les rendez-vous des consulats, ni les réservations proposées par d’autres prestataires."] },
      { heading: "Mises à jour", paragraphs: ["Nous pouvons mettre à jour cette politique. La date de la dernière mise à jour figure en haut de la page."] },
    ],
  },
  terms: {
    title: "Conditions d’utilisation",
    updated: "Dernière mise à jour",
    intro: "Ces conditions régissent l’utilisation du site et la demande de nos services.",
    sections: [
      { heading: "Nature du service", paragraphs: ["Nous aidons à préparer les dossiers de visa, à organiser les voyages et à donner des conseils. Nous ne sommes pas une autorité publique et ne faisons pas partie d’une ambassade, d’un consulat, d’une compagnie aérienne ou d’un hôtel, et nous n’avons aucun partenariat officiel avec eux, sauf mention explicite."] },
      { heading: "Aucune garantie", paragraphs: ["Nous ne garantissons ni l’obtention d’un visa, ni un rendez-vous, ni une réservation, et nous n’affichons aucun taux de réussite. La décision finale appartient aux autorités et aux prestataires."] },
      { heading: "Prix", paragraphs: ["Les prix sont indiqués sur demande (« prix sur demande »). Le prix et le contenu de la prestation sont confirmés par écrit avant tout engagement financier."] },
      { heading: "Votre responsabilité", paragraphs: ["Vous êtes responsable de l’exactitude des informations et des documents fournis, ainsi que de votre adresse e-mail et de votre numéro WhatsApp."] },
      { heading: "Demandes et annulation", paragraphs: ["L’envoi du formulaire crée une demande visible dans votre compte. Vous ou nous pouvons mettre fin à la demande à tout moment. Les conditions de remboursement sont propres à chaque prestation et confirmées par écrit avant votre engagement."] },
      { heading: "Communication", paragraphs: ["Les échanges par WhatsApp sont effectués manuellement par notre équipe ; nous n’envoyons pas de messages WhatsApp automatiques. Nous envoyons par e-mail les notifications liées à votre demande."] },
      { heading: "Responsabilité", paragraphs: ["Dans la limite permise par la loi, nous ne sommes pas responsables des décisions des autorités ni des retards ou annulations des compagnies aériennes, hôtels et autres prestataires."] },
      { heading: "Contact", paragraphs: ["Questions : {contactEmail}, ou WhatsApp {whatsapp}."] },
    ],
  },
  cookies: {
    title: "Politique de cookies",
    updated: "Dernière mise à jour",
    intro: "Le site utilise peu de cookies. Cette page les décrit.",
    sections: [
      { heading: "Cookies nécessaires à la connexion", paragraphs: ["Les cookies de session Supabase conservent votre état de connexion. Ils sont supprimés à la déconnexion ou à l’expiration. Sans eux, la connexion ne fonctionne pas."] },
      { heading: "Cookie de source de la demande", paragraphs: ["Lors de votre première visite, nous enregistrons un cookie nommé gta_lead_source qui indique le canal d’arrivée (TikTok, Instagram, Facebook, Google, WhatsApp, accès direct ou autre) et la valeur d’une balise de campagne le cas échéant. Il dure 30 jours et ne contient aucune information personnelle. Il nous aide à savoir quels canaux apportent de vraies demandes. Si vous le refusez ou le bloquez, la source de votre demande est enregistrée comme « autre », sans effet sur l’usage du site."] },
      { heading: "Ce que nous n’utilisons pas", paragraphs: ["Aucun cookie publicitaire ni outil d’analyse tiers suivant votre navigation d’un site à l’autre."] },
    ],
  },
};

const en: Pages = {
  privacy: {
    title: "Privacy notice",
    updated: "Last updated",
    intro: "This page explains what we collect when you request a GLOBALTRAVELASSI service, why, who can see it, and your rights.",
    sections: [
      { heading: "Who we are", paragraphs: ["GLOBALTRAVELASSI is a website and office that helps travellers prepare visa files and organise trips. Contact: {contactEmail}."] },
      {
        heading: "What we collect",
        paragraphs: [
          "Your name, email, WhatsApp number, nationality, country of residence, destination country, travel date if known, employment status, travel history, and the additional information you write in your request.",
          "Documents you upload to a private storage space.",
          "The source of your request: the channel through which you reached the site, for example an advert, a link carrying a campaign tag, or the site that referred you. We keep only the channel name, never your IP address or browser details.",
          "A log of the emails sent about your request, so we know whether they were delivered.",
        ],
      },
      {
        heading: "Why we use it",
        paragraphs: ["To prepare and follow your request, to contact you about it, to send notifications about your request, to protect the site from abuse and automated submissions, and to understand which channels bring us requests."],
      },
      {
        heading: "Who can access it",
        paragraphs: [
          "Only authorised staff. We use service providers for hosting, the database, storage and sending email; their role is limited to providing those services.",
          "We do not sell your information or share it with advertisers. The site uses no advertising tracking tools.",
        ],
      },
      { heading: "Documents", paragraphs: ["Your documents are kept in a private space. Only your account and authorised staff can reach them, through links that expire after a short time."] },
      { heading: "How long we keep it", paragraphs: ["We keep information for as long as it is needed for your request, and for any records the law requires us to keep. You can ask for deletion, except for what we must keep."] },
      { heading: "Your rights", paragraphs: ["You can ask to see your information, correct it, delete it, or object to its use, by writing to {contactEmail}, in line with the law that applies to you."] },
      { heading: "Official decisions", paragraphs: ["Visa decisions are made by the competent authorities. We do not guarantee approval, consulate appointments, or bookings made by other providers."] },
      { heading: "Changes to this notice", paragraphs: ["We may update this notice. The date of the last update is shown at the top of the page."] },
    ],
  },
  terms: {
    title: "Terms of use",
    updated: "Last updated",
    intro: "These terms govern your use of the site and your request for our services.",
    sections: [
      { heading: "What the service is", paragraphs: ["We help prepare visa files, organise travel and give advice. We are not a government body, and we are not part of any embassy, consulate, airline or hotel. We have no official partnership with them unless we say so explicitly."] },
      { heading: "No guarantees", paragraphs: ["We do not guarantee a visa, an appointment or a booking, and we do not publish any success rate. The final decision belongs to the authorities and the providers."] },
      { heading: "Prices", paragraphs: ["Prices are shown on request (“price on request”). The price and the content of the service are confirmed in writing before you commit to any payment."] },
      { heading: "Your responsibilities", paragraphs: ["You are responsible for the accuracy of the information and documents you provide, and for your email address and WhatsApp number."] },
      { heading: "Requests and cancellation", paragraphs: ["Sending the form creates a request that appears in your account. You or we can end a request at any time. Refund conditions depend on each service and are confirmed in writing before you commit."] },
      { heading: "Communication", paragraphs: ["WhatsApp conversations are handled manually by our team. We do not send automatic WhatsApp messages. We send email notifications about your request."] },
      { heading: "Liability", paragraphs: ["To the extent the law allows, we are not responsible for the decisions of authorities, or for delays or cancellations by airlines, hotels and other providers."] },
      { heading: "Contact", paragraphs: ["Questions: {contactEmail}, or WhatsApp {whatsapp}."] },
    ],
  },
  cookies: {
    title: "Cookie notice",
    updated: "Last updated",
    intro: "The site uses very few cookies. This page describes them.",
    sections: [
      { heading: "Cookies needed to sign in", paragraphs: ["Supabase session cookies keep you signed in. They are removed when you sign out or when they expire. Without them, sign-in does not work."] },
      { heading: "Request source cookie", paragraphs: ["On your first visit we store a cookie named gta_lead_source that records the channel you arrived from (TikTok, Instagram, Facebook, Google, WhatsApp, direct visit or other) and the value of a campaign tag, if there was one. It lasts 30 days and holds no personal information. It helps us see which channels bring real requests. If you decline or block it, the source of your request is recorded as “other”, and the rest of the site works as normal."] },
      { heading: "What we do not use", paragraphs: ["No advertising cookies and no third-party analytics that follow your browsing across sites."] },
    ],
  },
};

export const legal: Record<Locale, Pages> = { ar, fr, en };

/** Fills the public contact placeholders. Only configuration values are inserted, escaped by the page renderer. */
export function fillLegal(text: string, contact: { email: string; whatsapp: string }): string {
  return text.replace(/\{contactEmail\}/g, contact.email || "—").replace(/\{whatsapp\}/g, contact.whatsapp ? `+${contact.whatsapp}` : "—");
}
