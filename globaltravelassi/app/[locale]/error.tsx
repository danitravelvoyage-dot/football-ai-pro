"use client";

import { useEffect } from "react";

/** Shown when a page fails. Details are logged, never shown to visitors. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("page error", error.digest ?? "");
  }, [error]);
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "en";
  const text =
    lang === "ar"
      ? { title: "حدث خطأ ما", body: "نعتذر عن ذلك. حاول مرة أخرى بعد قليل.", retry: "إعادة المحاولة" }
      : lang === "fr"
        ? { title: "Une erreur est survenue", body: "Nous nous excusons. Veuillez réessayer dans un instant.", retry: "Réessayer" }
        : { title: "Something went wrong", body: "Sorry about that. Please try again in a moment.", retry: "Try again" };
  return (
    <section className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="font-display text-3xl text-navy-900">{text.title}</h1>
      <p className="mt-3 text-navy-600">{text.body}</p>
      <button onClick={reset} className="mt-8 min-h-12 rounded-full bg-gradient-to-b from-gold-400 to-gold-500 px-8 py-3 font-semibold text-navy-950">
        {text.retry}
      </button>
    </section>
  );
}
