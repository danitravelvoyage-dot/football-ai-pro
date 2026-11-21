import type { Locale } from "@/lib/i18n/config";
import type { CustomerEmailKind } from "./kinds";

/**
 * Wording of the customer emails, in each language. Placeholders: {name}, {ref}, {service}, {status}, {doc}. Values are escaped when the email is built.
 */
export interface EmailCopy {
  subject: string;
  heading: string;
  body: string[];
}

export interface EmailChrome {
  greeting: string;
  reference: string;
  service: string;
  status: string;
  document: string;
  teamMessage: string;
  cta: string;
  automatic: string;
  security: string;
  brandLine: string;
}

type Copies = Record<Exclude<CustomerEmailKind, "document_review_result">, EmailCopy> & {
  document_review_ok: EmailCopy;
  document_review_not_ok: EmailCopy;
};

const en: { chrome: EmailChrome; copy: Copies } = {
  chrome: {
    greeting: "Hello {name},",
    reference: "Reference",
    service: "Service",
    status: "Status",
    document: "Document",
    teamMessage: "Message from the team",
    cta: "Open my request",
    automatic: "This is an automatic message about your request. Please do not reply to it; contact us through your account or WhatsApp.",
    security: "We will never ask for your password by email.",
    brandLine: "Travel and visa assistance",
  },
  copy: {
    application_received: {
      subject: "We received your request {ref}",
      heading: "Your request has been received",
      body: ["Thank you. We have received your request for {service}.", "Our team will review it and contact you. You can upload your documents and follow every step from your account."],
    },
    application_status_updated: {
      subject: "Update on your request {ref}",
      heading: "Your request has been updated",
      body: ["The status of your request is now: {status}."],
    },
    additional_documents_requested: {
      subject: "Documents needed for your request {ref}",
      heading: "We need more documents",
      body: ["To continue with your request, we need additional documents.", "Please sign in to your account and upload them from the request page."],
    },
    application_approved: {
      subject: "Your request {ref} has been approved",
      heading: "Your request has been approved",
      body: ["Our team has approved your request to go ahead.", "Any next step is shown in your account."],
    },
    application_rejected: {
      subject: "Decision on your request {ref}",
      heading: "We cannot continue with your request",
      body: ["After review, we are unable to continue with your request.", "If you have a question, contact us and quote your reference."],
    },
    document_upload_confirmed: {
      subject: "Document received for {ref}",
      heading: "Your document has been received",
      body: ["We received your document: {doc}.", "Our team will check it."],
    },
    document_review_ok: {
      subject: "Document checked for {ref}",
      heading: "Your document has been checked",
      body: ["Your document {doc} has been checked and accepted by our team."],
    },
    document_review_not_ok: {
      subject: "Document needs attention for {ref}",
      heading: "Your document needs attention",
      body: ["Your document {doc} is no longer marked as checked.", "Please look at your request page, or contact us if you have a question."],
    },
  },
};

const fr: typeof en = {
  chrome: {
    greeting: "Bonjour {name},",
    reference: "Référence",
    service: "Service",
    status: "Statut",
    document: "Document",
    teamMessage: "Message de l’équipe",
    cta: "Ouvrir ma demande",
    automatic: "Ceci est un message automatique au sujet de votre demande. Merci de ne pas y répondre ; contactez-nous depuis votre compte ou par WhatsApp.",
    security: "Nous ne vous demanderons jamais votre mot de passe par e-mail.",
    brandLine: "Assistance voyage et visa",
  },
  copy: {
    application_received: {
      subject: "Nous avons reçu votre demande {ref}",
      heading: "Votre demande a bien été reçue",
      body: ["Merci. Nous avons reçu votre demande pour : {service}.", "Notre équipe va l’examiner et vous contacter. Vous pouvez déposer vos documents et suivre chaque étape depuis votre compte."],
    },
    application_status_updated: {
      subject: "Mise à jour de votre demande {ref}",
      heading: "Votre demande a été mise à jour",
      body: ["Le statut de votre demande est maintenant : {status}."],
    },
    additional_documents_requested: {
      subject: "Documents à fournir pour votre demande {ref}",
      heading: "Nous avons besoin de documents supplémentaires",
      body: ["Pour poursuivre votre demande, nous avons besoin de documents supplémentaires.", "Connectez-vous à votre compte et déposez-les depuis la page de la demande."],
    },
    application_approved: {
      subject: "Votre demande {ref} est approuvée",
      heading: "Votre demande est approuvée",
      body: ["Notre équipe a approuvé la poursuite de votre demande.", "La suite est indiquée dans votre compte."],
    },
    application_rejected: {
      subject: "Décision concernant votre demande {ref}",
      heading: "Nous ne pouvons pas poursuivre votre demande",
      body: ["Après examen, nous ne sommes pas en mesure de poursuivre votre demande.", "Pour toute question, contactez-nous en indiquant votre référence."],
    },
    document_upload_confirmed: {
      subject: "Document reçu pour {ref}",
      heading: "Votre document a bien été reçu",
      body: ["Nous avons reçu votre document : {doc}.", "Notre équipe va le vérifier."],
    },
    document_review_ok: {
      subject: "Document vérifié pour {ref}",
      heading: "Votre document a été vérifié",
      body: ["Votre document {doc} a été vérifié et accepté par notre équipe."],
    },
    document_review_not_ok: {
      subject: "Document à revoir pour {ref}",
      heading: "Votre document demande votre attention",
      body: ["Votre document {doc} n’est plus marqué comme vérifié.", "Consultez la page de votre demande, ou contactez-nous pour toute question."],
    },
  },
};

const ar: typeof en = {
  chrome: {
    greeting: "مرحبًا {name}،",
    reference: "المرجع",
    service: "الخدمة",
    status: "الحالة",
    document: "المستند",
    teamMessage: "رسالة من الفريق",
    cta: "فتح طلبي",
    automatic: "هذه رسالة آلية بخصوص طلبك. يُرجى عدم الرد عليها؛ تواصل معنا من خلال حسابك أو عبر واتساب.",
    security: "لن نطلب منك كلمة المرور عبر البريد الإلكتروني أبدًا.",
    brandLine: "مساعدة في السفر والتأشيرات",
  },
  copy: {
    application_received: {
      subject: "استلمنا طلبك {ref}",
      heading: "تم استلام طلبك",
      body: ["شكرًا لك. استلمنا طلبك الخاص بخدمة: {service}.", "سيراجع فريقنا طلبك ويتواصل معك. يمكنك رفع مستنداتك ومتابعة كل خطوة من حسابك."],
    },
    application_status_updated: {
      subject: "تحديث بخصوص طلبك {ref}",
      heading: "تم تحديث طلبك",
      body: ["أصبحت حالة طلبك الآن: {status}."],
    },
    additional_documents_requested: {
      subject: "مستندات مطلوبة لطلبك {ref}",
      heading: "نحتاج إلى مستندات إضافية",
      body: ["لمواصلة معالجة طلبك، نحتاج إلى مستندات إضافية.", "يُرجى تسجيل الدخول إلى حسابك ورفعها من صفحة الطلب."],
    },
    application_approved: {
      subject: "تمت الموافقة على طلبك {ref}",
      heading: "تمت الموافقة على طلبك",
      body: ["وافق فريقنا على مواصلة معالجة طلبك.", "ستجد الخطوة التالية موضحة في حسابك."],
    },
    application_rejected: {
      subject: "قرار بخصوص طلبك {ref}",
      heading: "لا يمكننا مواصلة طلبك",
      body: ["بعد المراجعة، لا يمكننا مواصلة معالجة طلبك.", "إن كان لديك أي سؤال، تواصل معنا مع ذكر مرجع طلبك."],
    },
    document_upload_confirmed: {
      subject: "استلمنا مستندًا للطلب {ref}",
      heading: "تم استلام مستندك",
      body: ["استلمنا مستندك: {doc}.", "سيتحقق منه فريقنا."],
    },
    document_review_ok: {
      subject: "تم التحقق من مستند للطلب {ref}",
      heading: "تم التحقق من مستندك",
      body: ["تحقق فريقنا من مستندك ({doc}) وقبله."],
    },
    document_review_not_ok: {
      subject: "مستند يحتاج إلى مراجعة للطلب {ref}",
      heading: "مستندك يحتاج إلى انتباهك",
      body: ["لم يعد مستندك ({doc}) معلَّمًا كمستند تم التحقق منه.", "يُرجى مراجعة صفحة طلبك، أو التواصل معنا إن كان لديك سؤال."],
    },
  },
};

export const emailText: Record<Locale, typeof en> = { en, fr, ar };
