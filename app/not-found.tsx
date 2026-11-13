import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <div className="panel mx-auto max-w-md p-8 text-center">
      <div className="num text-5xl font-bold text-emerald-400">404</div>
      <p className="mt-2 text-sm text-mute">{t("common.notFound")}</p>
      <Link href="/" className="btn btn-primary mt-6">{t("nav.dashboard")}</Link>
    </div>
  );
}
