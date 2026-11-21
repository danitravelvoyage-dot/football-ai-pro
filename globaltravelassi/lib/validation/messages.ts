import type { Dict } from "@/lib/i18n";

/** Every code an action or validator can return, mapped to the visitor's language. */
export function formMessages(dict: Dict): Record<string, string> {
  return {
    // validation
    required: dict.common.required,
    invalid_email: dict.common.invalidEmail,
    invalid_phone: dict.common.invalidPhone,
    invalid_date: dict.common.invalidDate,
    too_long: dict.common.tooLong,
    weak: dict.auth.errors.weak,
    mismatch: dict.auth.errors.mismatch,
    file_too_large: dict.dashboard.fileTooLarge,
    invalid_option: dict.common.invalidInput,
    // auth
    invalid: dict.auth.errors.invalid,
    not_confirmed: dict.auth.errors.notConfirmed,
    exists: dict.auth.errors.exists,
    rate_limit: dict.auth.errors.rateLimit,
    disabled: dict.auth.errors.disabled,
    expired: dict.auth.errors.expired,
    check_email: dict.auth.checkEmail,
    forgot_sent: dict.auth.forgotSent,
    reset_done: dict.auth.resetDone,
    // general
    saved: dict.common.saved,
    generic: dict.common.genericError,
    unauthorized: dict.common.unauthorized,
    not_found: dict.common.notFound,
    locked: dict.dashboard.locked,
    invalid_input: dict.common.invalidInput,
    // domain
    application_created: dict.apply.successTitle,
    document_added: dict.dashboard.uploaded,
    document_removed: dict.dashboard.removeDoc,
    status_saved: dict.admin.detail.statusSaved,
    note_saved: dict.admin.detail.addNote,
    payment_saved: dict.admin.detail.paymentSaved,
    application_deleted: dict.admin.detail.deleted,
    service_saved: dict.admin.servicesPage.saved,
    profile_saved: dict.dashboard.profileSaved,
    customer_updated: dict.common.saved,
    timeline_not_saved: dict.customerEmails.timelineNotSaved,
    emails_retried: dict.customerEmails.retried,
    workflow_started: dict.commandCenter.startTitle,
    tick_done: dict.commandCenter.tickDone,
    decided: dict.commandCenter.decided,
  };
}
