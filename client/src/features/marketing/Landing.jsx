import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  SHOW_SOCIAL_PROOF,
  copy,
  langFromPath,
  pathForLang,
} from './landingCopy';
import styles from './Landing.module.css';

/**
 * Direction contract (persuade · notebook world)
 * THESIS: Free personal nutrition notebook — logging as easy as flip-flops; not a paywalled tracker.
 * OWN-WORLD: Warm paper ground, navy brand ink, primary blue CTA, Nunito wordmark, hairline sections.
 * STORY: Visitor believes free-for-individuals, meets Diego honestly, starts with email OTP.
 * FIRST VIEWPORT: Atmosphere + Flops brand + signature line + Start free (CTA in first fold).
 * FORM: Morning notebook page (established FLOPS materials, elevated for marketing).
 */

function useReveal() {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nodes = root.querySelectorAll('[data-reveal]');
    if (reduce) {
      nodes.forEach((el) => el.setAttribute('data-in', '1'));
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-in', '1');
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    nodes.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return rootRef;
}

export default function Landing() {
  const { pathname } = useLocation();
  const lang = langFromPath(pathname);
  const t = copy[lang];
  const otherLang = lang === 'en' ? 'es' : 'en';
  const rootRef = useReveal();

  useEffect(() => {
    document.documentElement.lang = lang;
    const prevTitle = document.title;
    document.title = t.metaTitle;
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute('content') || '';
    if (meta) meta.setAttribute('content', t.metaDescription);
    return () => {
      document.documentElement.lang = 'en';
      document.title = prevTitle;
      if (meta) meta.setAttribute('content', prevDesc);
    };
  }, [lang, t.metaTitle, t.metaDescription]);

  return (
    <div className={styles.page} ref={rootRef}>
      <div className={styles.atmosphere} aria-hidden="true">
        <div className={styles.blobA} />
        <div className={styles.blobB} />
      </div>

      <header className={styles.top}>
        <div className={styles.topInner}>
          <Link to={pathForLang(lang)} className={styles.brand} aria-label={t.brandAria}>
            <span className={styles.badgeWrap}>
              <img src="/flops-badge.png" alt="" className={styles.badge} />
            </span>
            <span className={styles.brandName}>Flops</span>
          </Link>
          <div className={styles.topActions}>
            <Link
              to={pathForLang(otherLang)}
              className={styles.langToggle}
              aria-label={t.langSwitchAria}
              hrefLang={otherLang}
            >
              {t.langSwitch}
            </Link>
            <Link to="/login" className={styles.signIn}>
              {t.signIn}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="landing-hero-title">
          <p className={`${styles.heroBrand} ${styles.enter}`} data-delay="0">
            {t.heroBrand}
          </p>
          <h1 id="landing-hero-title" className={`${styles.headline} ${styles.enter}`} data-delay="1">
            {t.heroLine}
          </h1>
          <p className={`${styles.lede} ${styles.enter}`} data-delay="2">
            {t.heroSupport}
          </p>
          <div className={`${styles.heroActions} ${styles.enter}`} data-delay="3">
            <Link to="/login" className={`btn-primary ${styles.cta}`}>
              {t.startFree}
            </Link>
            <a href="#how-it-works" className={`btn-secondary ${styles.ctaSecondary}`}>
              {t.howItWorksCta}
            </a>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="mission-title" data-reveal>
          <h2 id="mission-title" className={styles.sectionTitle}>
            {t.missionTitle}
          </h2>
          {t.missionBody.map((para) => (
            <p key={para.slice(0, 24)} className={styles.prose}>
              {para}
            </p>
          ))}
        </section>

        <section
          className={styles.section}
          id="how-it-works"
          aria-labelledby="how-title"
          data-reveal
        >
          <h2 id="how-title" className={styles.sectionTitle}>
            {t.howTitle}
          </h2>
          <ol className={styles.steps}>
            {t.howSteps.map((step, i) => (
              <li key={step.title} style={{ '--i': i }}>
                <span className={styles.stepNum} aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3 className={styles.blockTitle}>{step.title}</h3>
                  <p className={styles.blockBody}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="today-title" data-reveal>
          <div className={styles.split}>
            <div>
              <h2 id="today-title" className={styles.sectionTitle}>
                {t.todayTitle}
              </h2>
              <p className={styles.prose}>{t.todayBody}</p>
            </div>
            <div>
              <h2 id="vision-title" className={styles.sectionTitle}>
                {t.visionTitle}
              </h2>
              <p className={styles.prose}>{t.visionBody}</p>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="about-title" data-reveal>
          <h2 id="about-title" className={styles.sectionTitle}>
            {t.aboutTitle}
          </h2>
          {t.aboutBody.map((para) => (
            <p key={para.slice(0, 24)} className={styles.prose}>
              {para}
            </p>
          ))}
        </section>

        {/* Template for real testimonials later. SHOW_SOCIAL_PROOF stays false until quotes exist. */}
        {SHOW_SOCIAL_PROOF ? (
          <section className={styles.section} aria-labelledby="social-title" data-reveal>
            <h2 id="social-title" className={styles.sectionTitle}>
              {t.socialTitle}
            </h2>
            <ul className={styles.quotes}>
              <li>
                <blockquote>
                  <p>{/* Real quote */}</p>
                  <footer>{/* Name · context */}</footer>
                </blockquote>
              </li>
            </ul>
          </section>
        ) : (
          <section className={styles.socialPlaceholder} aria-hidden="true" data-social-template>
            {/*
              Enable later: set SHOW_SOCIAL_PROOF = true in landingCopy.js
              and fill quotes with real names. Never invent reviews.
            */}
            <p className={styles.socialNoteHidden}>{t.socialNote}</p>
          </section>
        )}

        <section className={styles.close} aria-labelledby="close-title" data-reveal>
          <h2 id="close-title" className={styles.closeTitle}>
            {t.closeTitle}
          </h2>
          <p className={styles.lede}>{t.closeBody}</p>
          <Link to="/login" className={`btn-primary ${styles.cta}`}>
            {t.closeCta}
          </Link>
        </section>
      </main>

      <footer className={styles.foot}>
        <div className={styles.footRow}>
          <span>
            © {new Date().getFullYear()} {t.footerRights}
          </span>
          <span className={styles.footSoon}>
            {t.footerTerms} · {t.footerPrivacy} ({t.footerComingSoon})
          </span>
        </div>
        <div className={styles.footRow}>
          <span>
            {t.footerContact}:{' '}
            <a href={`tel:+1${t.footerPhone.replace(/\D/g, '')}`}>{t.footerPhone}</a>
          </span>
          <Link to="/login">{t.signIn}</Link>
        </div>
        <p className={styles.footPromise}>{t.footerPromise}</p>
      </footer>
    </div>
  );
}
