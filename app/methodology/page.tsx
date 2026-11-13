import { Panel, PageHeader } from "@/components/ui";
import { MAX_PLAUSIBLE_EDGE, MIN_QUALITY_FOR_VALUE, MAX_STAKE_FRACTION } from "@/lib/betting";
import { getI18n } from "@/lib/i18n/server";
import { DC_RHO, DEFAULT_FIRST_HALF_SHARE, H2H_MAX_EFFECT, poissonDcModel } from "@/models/engine";
import { DEFAULT_RATING_OPTIONS } from "@/models/ratings";

export const metadata = { title: "Methodology" };

type Section = { title: string; body: string[]; formula?: string };

function content(locale: "ar" | "en"): Section[] {
  const o = DEFAULT_RATING_OPTIONS;
  if (locale === "en")
    return [
      {
        title: "1. Data sources & transparency",
        body: [
          "Fixtures, results, standings, head-to-head and squads come from football-data.org (free tier). Bookmaker odds come from The Odds API. Injuries, suspensions and official lineups come from API-Football. Every block on the site shows its provider and the time the data was fetched.",
          "When a provider does not supply something (e.g. xG, corners or cards on the football-data.org free tier), the platform shows it as unavailable. It is never estimated or invented. Understat and Sofascore are not integrated because they have no officially permitted public API, and we do not scrape.",
          "Without API keys the app runs in DEMO mode. DEMO data is simulated from a seeded random model and is clearly labelled everywhere.",
        ],
      },
      {
        title: "2. Team ratings",
        body: [
          `Each team gets an attack and a defence rating, fitted by iterative maximum-likelihood-style proportional fitting of a multiplicative Poisson model (Maher 1982 / Dixon & Coles 1997). The fit uses competition matches plus each team's recent matches in all competitions.`,
          `Recent form is handled by exponential time decay with a half-life of ${o.halfLifeDays} days. Every team also gets ${o.shrinkageMatches} pseudo-matches at league-average level, which pulls small samples toward 1.00. When the provider supplies xG, the goal signal is ${o.xgWeight * 100}% xG and ${(1 - o.xgWeight) * 100}% actual goals.`,
          "Home advantage is estimated from the data (bounded between 0.9 and 1.6) and removed for neutral-venue finals.",
        ],
        formula: "λ_home = base × homeAdv × attack_home × defence_away\nλ_away = base × attack_away × defence_home",
      },
      {
        title: "3. Goal distribution & markets",
        body: [
          `Goals for each side follow a Poisson distribution with the rates above. A Dixon–Coles correction (ρ = ${DC_RHO}) adjusts the four low-score cells, and the score matrix (0–10 goals) is renormalised so it sums to exactly 1.`,
          "Every market is read off the same matrix: 1X2, double chance, over/under 0.5–4.5, BTTS, correct score, team goals and Asian handicap (whole, half and quarter lines with push probabilities). Displayed 1X2 percentages use largest-remainder rounding, so they always total exactly 100.0%.",
          `First-half markets scale both rates by the share of goals scored before half-time. That share is estimated from provider half-time scores when there are at least 20 matches, otherwise a documented prior of ${DEFAULT_FIRST_HALF_SHARE * 100}% is used and flagged.`,
          "Corners and cards are modelled only when the provider supplies those statistics for at least 5 matches per team. This is a Poisson approximation; real corner counts are over-dispersed.",
        ],
        formula: "P(H = h, A = a) = τ(h,a) × Pois(h; λ_home) × Pois(a; λ_away)",
      },
      {
        title: "4. Head-to-head (low weight)",
        body: [`Head-to-head results are used only with at least 3 previous meetings, with a weight that grows with sample size. They can move expected goals by at most ±${H2H_MAX_EFFECT * 100}%.`],
      },
      {
        title: "5. Data quality score",
        body: [
          "Every prediction carries a 0–100% quality score. It is based on recent matches available for each team (35% each, full credit at 20 matches), the league sample size (20%, full credit at 150 matches) and the availability of xG (10%). Below 45% the quality is LOW, and Asian handicap lines are hidden.",
        ],
      },
      {
        title: "6. Betting value",
        body: [
          "Implied probability = 1 / decimal odds. The bookmaker margin (overround) is removed with the power method, which handles the favourite–longshot bias better than simple normalisation. Proportional normalisation is also available through the API.",
          "Every prediction carries a probability uncertainty (one standard error), estimated from walk-forward simulations as SE(n) = 0.05 + 0.10/√n, where n is the smaller team sample. With 10 matches per team this is about ±8 percentage points — larger than a typical bookmaker margin. That is why most apparent “edges” are noise.",
          `A selection is labelled “value” ONLY when EV stays positive after subtracting one standard error from the model probability [(p − SE) × odds − 1 > 0], the data quality score is at least ${MIN_QUALITY_FOR_VALUE * 100}%, AND the model is no more than ${MAX_PLAUSIBLE_EDGE * 100} percentage points above the margin-free market. Larger gaps usually mean model error (e.g. small early-season samples) or information the model lacks, so they are flagged rather than recommended.`,
          `Stake suggestions use fractional Kelly (10%, 25% or 50%) and are capped at ${MAX_STAKE_FRACTION * 100}% of bankroll.`,
          "Positive EV is model-dependent. If the model is wrong, the edge is not real. No result is guaranteed.",
        ],
        formula: "EV = (model probability × decimal odds) − 1\nKelly f* = (b·p − q) / b,  b = odds − 1",
      },
      {
        title: "7. Prediction tracking & evaluation",
        body: [
          "Tracked predictions are recomputed on the server at the moment of recording and can only be stored before kick-off. In PostgreSQL a database trigger rejects any later change to probabilities, market, odds or model version. Only the result columns are written after the match.",
          "Metrics: 1X2 accuracy (highest-probability outcome), hit rate per market, multi-class Brier score (0 = perfect, uniform baseline = 0.667), log loss, ROI on unit stakes when odds were recorded, and closing-line value when odds were captured close to kick-off.",
          "League pages run a walk-forward backtest. Every finished match is predicted using only matches played before it, so there is no look-ahead.",
        ],
      },
      {
        title: "8. AI match report",
        body: [
          "The report is generated from deterministic templates filled only with the retrieved and computed numbers shown on the match page. No free-form text model invents facts. Psychological or morale claims are never made. Context comes only from fixtures, standings and provider-reported team news.",
        ],
      },
      {
        title: "9. Limitations",
        body: [
          "The model does not see weather, referees, tactical changes, travel, or team news the provider does not report. Football results are highly random: even a 70% favourite loses or draws about 3 times in 10. Use these numbers as one input among many, and never as a promise.",
          `Model version: ${poissonDcModel.version}. The architecture lets additional models (e.g. machine-learning models) be registered through the same interface and evaluated with the same tracker.`,
        ],
      },
    ];
  return [
    {
      title: "1. مصادر البيانات والشفافية",
      body: [
        "تأتي المباريات والنتائج والترتيب والمواجهات المباشرة وقوائم اللاعبين من football-data.org (الخطة المجانية)، وأودز شركات المراهنات من The Odds API، والإصابات والإيقافات والتشكيلات الرسمية من API-Football. يعرض كل قسم في الموقع المزود ووقت جلب البيانات.",
        "إذا لم يوفر المزود معلومة ما (مثل xG أو الركنيات أو البطاقات في خطة football-data.org المجانية) فإنها تظهر كغير متاحة، ولا تُقدَّر أو تُختلق أبدًا. لم يتم دمج Understat وSofascore لعدم وجود واجهة API عامة مسموح بها رسميًا، ونحن لا نقوم بالكشط.",
        "بدون مفاتيح API يعمل التطبيق في الوضع التجريبي (DEMO). بيانات هذا الوضع مُحاكاة من نموذج عشوائي ثابت البذرة، وموسومة بوضوح في كل مكان.",
      ],
    },
    {
      title: "2. تقييمات الفرق",
      body: [
        "لكل فريق تقييم للهجوم وآخر للدفاع، يُقدَّران بنموذج بواسون الضربي (Maher 1982 / Dixon & Coles 1997) عبر التوفيق التناسبي التكراري. يستخدم التقدير مباريات البطولة إضافة إلى المباريات الأخيرة لكل فريق في جميع البطولات.",
        `يُعالَج الأداء الحديث بتضاؤل زمني أُسّي بعمر نصفي ${o.halfLifeDays} يومًا. يُضاف لكل فريق ${o.shrinkageMatches} مباريات افتراضية بمستوى متوسط الدوري لتقريب العينات الصغيرة من 1.00. عند توفر xG من المزود يكون مؤشر الأهداف ${o.xgWeight * 100}% xG و${(1 - o.xgWeight) * 100}% أهدافًا فعلية.`,
        "تُقدَّر أفضلية الأرض من البيانات (بين 0.9 و1.6)، وتُزال في النهائيات على ملعب محايد.",
      ],
      formula: "λ_home = base × homeAdv × attack_home × defence_away\nλ_away = base × attack_away × defence_home",
    },
    {
      title: "3. توزيع الأهداف والأسواق",
      body: [
        `تتبع أهداف كل فريق توزيع بواسون بالمعدلات السابقة. يعدّل تصحيح Dixon–Coles (ρ = ${DC_RHO}) خلايا النتائج المنخفضة الأربع، ثم تُعاد معايرة مصفوفة النتائج (0–10 أهداف) لتساوي 1 بالضبط.`,
        "تُشتق كل الأسواق من المصفوفة نفسها: 1X2، والفرصة المزدوجة، وأكثر/أقل من 0.5 إلى 4.5، وتسجيل الفريقين، والنتيجة الصحيحة، وأهداف كل فريق، والهانديكاب الآسيوي (الخطوط الكاملة والنصفية والربعية مع احتمال الاسترجاع). تُقرَّب نسب 1X2 المعروضة بطريقة الباقي الأكبر، فمجموعها دائمًا 100.0% بالضبط.",
        `تُضرب معدلات الشوط الأول في نسبة الأهداف المسجلة قبل الاستراحة. تُقدَّر هذه النسبة من نتائج الشوط الأول لدى المزود عند توفر 20 مباراة على الأقل، وإلا تُستخدم قيمة مسبقة موثقة قدرها ${DEFAULT_FIRST_HALF_SHARE * 100}% مع الإشارة إلى ذلك.`,
        "لا تُنمذج الركنيات والبطاقات إلا إذا وفر المزود إحصائياتها لخمس مباريات على الأقل لكل فريق. هذا تقريب بواسون، علمًا أن أعداد الركنيات الفعلية أكثر تشتتًا.",
      ],
      formula: "P(H = h, A = a) = τ(h,a) × Pois(h; λ_home) × Pois(a; λ_away)",
    },
    {
      title: "4. المواجهات المباشرة (وزن منخفض)",
      body: [`لا تُستخدم المواجهات المباشرة إلا مع 3 لقاءات سابقة على الأقل، ويزداد وزنها مع حجم العينة. أقصى تأثير لها على الأهداف المتوقعة ±${H2H_MAX_EFFECT * 100}%.`],
    },
    {
      title: "5. مؤشر جودة البيانات",
      body: ["لكل توقع مؤشر جودة من 0 إلى 100%. يعتمد على عدد المباريات الحديثة المتاحة لكل فريق (35% لكل منهما، والدرجة الكاملة عند 20 مباراة)، وحجم عينة الدوري (20%، والدرجة الكاملة عند 150 مباراة)، وتوفر xG (10%). إذا قلّ عن 45% تكون الجودة منخفضة وتُخفى خطوط الهانديكاب الآسيوي."],
    },
    {
      title: "6. قيمة الرهان",
      body: [
        "الاحتمال الضمني = 1 ÷ الأودز العشرية. يُزال هامش شركة المراهنات بطريقة القوة، وهي أفضل من التطبيع البسيط في معالجة انحياز المرشح والمستبعد. يتوفر التطبيع التناسبي أيضًا عبر واجهة API.",
        "لكل توقع هامش عدم يقين في الاحتمال (خطأ معياري واحد) مقدَّر من محاكاة تقدمية: SE(n) = 0.05 + 0.10/√n حيث n عينة الفريق الأصغر. مع 10 مباريات لكل فريق يبلغ نحو ±8 نقاط مئوية — أكبر من هامش شركة المراهنات المعتاد، ولهذا فإن معظم «الأفضليات» الظاهرة مجرد ضجيج.",
        `لا يُصنَّف الاختيار «رهان قيمة» إلا إذا بقيت القيمة المتوقعة إيجابية بعد طرح خطأ معياري واحد من احتمال النموذج [(p − SE) × الأودز − 1 > 0]، ومؤشر جودة البيانات ${MIN_QUALITY_FOR_VALUE * 100}% على الأقل، ولم يتجاوز احتمال النموذج احتمال السوق بعد إزالة الهامش بأكثر من ${MAX_PLAUSIBLE_EDGE * 100} نقاط مئوية. الفوارق الأكبر تعني غالبًا خطأ في النموذج (مثل العينات الصغيرة في بداية الموسم) أو معلومات لا يراها النموذج، لذا يُشار إليها ولا يُوصى بها.`,
        `تستخدم اقتراحات الرهان كيلي الجزئي (10% أو 25% أو 50%) بحد أقصى ${MAX_STAKE_FRACTION * 100}% من رأس المال.`,
        "القيمة المتوقعة الإيجابية تعتمد على النموذج. إذا كان النموذج مخطئًا فالأفضلية غير حقيقية. لا توجد نتيجة مضمونة.",
      ],
      formula: "EV = (model probability × decimal odds) − 1\nKelly f* = (b·p − q) / b,  b = odds − 1",
    },
    {
      title: "7. تتبع التوقعات وتقييمها",
      body: [
        "يُعاد حساب التوقع المتتبَّع على الخادم لحظة تسجيله، ولا يمكن حفظه إلا قبل انطلاق المباراة. في PostgreSQL يرفض مُشغِّل في قاعدة البيانات أي تعديل لاحق على الاحتمالات أو السوق أو الأودز أو إصدار النموذج، ولا تُكتب بعد المباراة إلا أعمدة النتيجة.",
        "المقاييس: دقة 1X2 (النتيجة ذات الاحتمال الأعلى)، ونسبة النجاح لكل سوق، ومؤشر براير متعدد الفئات (0 = مثالي، وخط الأساس المنتظم 0.667)، والخسارة اللوغاريتمية، والعائد على رهان بوحدة ثابتة عند تسجيل الأودز، وقيمة خط الإغلاق عند تسجيل الأودز قرب انطلاق المباراة.",
        "تُجري صفحات الدوريات اختبارًا تاريخيًا تقدميًا: كل مباراة منتهية تُتوقع باستخدام المباريات التي سبقتها فقط، فلا يوجد تسرب للمعلومات المستقبلية.",
      ],
    },
    {
      title: "8. تقرير المباراة بالذكاء الاصطناعي",
      body: ["يُولَّد التقرير من قوالب حتمية لا تُملأ إلا بالأرقام المسترجعة والمحسوبة المعروضة في صفحة المباراة. لا يختلق أي نموذج نصي حر حقائق، ولا تُطلق أي ادعاءات نفسية أو معنوية. السياق مستمد فقط من المباريات والترتيب وأخبار الفرق التي يبلغ عنها المزود."],
    },
    {
      title: "9. القيود",
      body: [
        "لا يرى النموذج الطقس أو الحكام أو التغييرات التكتيكية أو السفر أو أخبار الفريق التي لا يبلغ عنها المزود. نتائج كرة القدم عشوائية جدًا: حتى المرشح بنسبة 70% يخسر أو يتعادل نحو 3 مرات من كل 10. استخدم هذه الأرقام كأحد المدخلات، ولا تعاملها أبدًا كوعد.",
        `إصدار النموذج: ${poissonDcModel.version}. تتيح البنية تسجيل نماذج إضافية (مثل نماذج التعلم الآلي) عبر الواجهة نفسها وتقييمها بأداة التتبع نفسها.`,
      ],
    },
  ];
}

export default async function MethodologyPage() {
  const { t, locale } = await getI18n();
  return (
    <>
      <PageHeader title={t("method.title")} subtitle={t("method.subtitle")} />
      <div className="grid gap-5 lg:grid-cols-2">
        {content(locale).map((s) => (
          <Panel key={s.title} title={s.title}>
            <div className="space-y-3 text-sm leading-relaxed text-slate-300">
              {s.body.map((b, i) => <p key={i}>{b}</p>)}
              {s.formula && <pre className="num overflow-x-auto rounded-lg border border-line bg-ink-950 p-3 text-xs text-emerald-300" dir="ltr">{s.formula}</pre>}
            </div>
          </Panel>
        ))}
      </div>
      <p className="mt-6 text-xs text-gold-300">{t("disclaimer.footer")}</p>
    </>
  );
}
