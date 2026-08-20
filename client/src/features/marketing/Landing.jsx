import { Link } from 'react-router-dom';
import MacroTotals from '@shared/ui/MacroTotals';
import styles from './Landing.module.css';

const DEMO_TOTALS = { calories: 1842, protein_g: 141, carbs_g: 168, fat_g: 58 };
const DEMO_TARGETS = {
  calories: { min: 2200, max: 2500 },
  protein_g: { min: 150, max: 180 },
  carbs_g: { min: 200, max: 260 },
  fat_g: { min: 55, max: 75 },
};

export default function Landing() {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.topInner}>
          <Link to="/" className={styles.brand} aria-label="Flops home">
            <span className={styles.badgeWrap}>
              <img src="/flops-badge.png" alt="" className={styles.badge} />
            </span>
            <span className={styles.brandName}>Flops</span>
          </Link>
          <Link to="/login" className="btn-primary">
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="landing-hero-title">
          <div className={styles.heroCopy}>
            <h1 id="landing-hero-title" className={styles.headline}>
              A nutrition notebook you actually keep.
            </h1>
            <p className={styles.lede}>
              You write meals, lifts, and supplements. AI helps when you ask.
              The day stays until you flip it.
            </p>
            <div className={styles.heroActions}>
              <Link to="/login" className="btn-primary">
                Open your notebook
              </Link>
              <a href="#how-it-works" className="btn-secondary">
                How it works
              </a>
            </div>
          </div>

          <div className={styles.preview} aria-hidden="true">
            <p className={styles.previewDate}>Thursday, Aug 20</p>
            <MacroTotals totals={DEMO_TOTALS} targets={DEMO_TARGETS} />
            <div className={styles.logCard}>
              <div className={styles.logHead}>
                <span className={styles.logTitle}>Today’s meals</span>
                <span className={styles.logMeta}>1 meal · 632 kcal</span>
              </div>
              <div className={styles.mealRow}>
                <span className={styles.mealName}>Chicken rice bowl</span>
                <span className={styles.mealMacros}>
                  632 cal · P 41 g · C 76 g · F 19 g
                </span>
              </div>
              <p className={styles.weightLine}>Today’s weight · 151.6 lb</p>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="what-title">
          <h2 id="what-title" className={styles.sectionTitle}>What Flops is</h2>
          <p className={styles.sectionLede}>
            A personal nutrition and training notebook for the web. Not a streak
            app. Not a coach that talks over you.
          </p>
          <div className={styles.grid3}>
            <div>
              <h3 className={styles.blockTitle}>Log meals</h3>
              <p className={styles.blockBody}>
                Build a receipt from a recipe or ingredients. Or describe the
                plate and let AI estimate, only when you ask.
              </p>
            </div>
            <div>
              <h3 className={styles.blockTitle}>See the day</h3>
              <p className={styles.blockBody}>
                Macros, today’s weight, and supplements on one page. The numbers
                sit still so you can actually read them.
              </p>
            </div>
            <div>
              <h3 className={styles.blockTitle}>Look back</h3>
              <p className={styles.blockBody}>
                History and adherence show how the week went. Missed a day? Flip
                back and write it in.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="diff-title">
          <h2 id="diff-title" className={styles.sectionTitle}>How it’s different</h2>
          <div className={styles.grid3}>
            <div>
              <h3 className={styles.blockTitle}>You hold the day</h3>
              <p className={styles.blockBody}>
                Midnight does not jump you into tomorrow. The page you are
                writing on stays until you turn it.
              </p>
            </div>
            <div>
              <h3 className={styles.blockTitle}>AI is opt-in</h3>
              <p className={styles.blockBody}>
                Saved recipes and library foods never need a model. Speak or
                type a meal only when that is faster.
              </p>
            </div>
            <div>
              <h3 className={styles.blockTitle}>The log is private</h3>
              <p className={styles.blockBody}>
                Sign in with an email code. No ads. We do not sell your meals.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="in-it-title">
          <h2 id="in-it-title" className={styles.sectionTitle}>What’s in it</h2>
          <dl className={styles.surfaces}>
            <div>
              <dt>Today</dt>
              <dd>The page you write on: meals, macros, weight, supplements.</dd>
            </div>
            <div>
              <dt>Library</dt>
              <dd>Recipes and ingredients you reuse, instead of searching a crowd-sourced database.</dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>A calendar of how closely the week matched your goals.</dd>
            </div>
            <div>
              <dt>Training</dt>
              <dd>Workouts next to the food log, in the same notebook.</dd>
            </div>
            <div>
              <dt>Goals</dt>
              <dd>Calorie and macro targets for the day you are looking at.</dd>
            </div>
          </dl>
          <p className={styles.aside}>
            Coaches can be invited later. They see what you already logged. They
            do not rewrite your page.
          </p>
        </section>

        <section className={styles.section} id="how-it-works" aria-labelledby="how-title">
          <h2 id="how-title" className={styles.sectionTitle}>How it works</h2>
          <ol className={styles.steps}>
            <li>
              <span className={styles.stepNum}>1</span>
              <div>
                <h3 className={styles.blockTitle}>Email a code</h3>
                <p className={styles.blockBody}>
                  No password to forget. We send a six-digit code and open your notebook.
                </p>
              </div>
            </li>
            <li>
              <span className={styles.stepNum}>2</span>
              <div>
                <h3 className={styles.blockTitle}>Write today’s meals</h3>
                <p className={styles.blockBody}>
                  Log a recipe, build a receipt, or ask AI to estimate. Tick off
                  supplements as you take them.
                </p>
              </div>
            </li>
            <li>
              <span className={styles.stepNum}>3</span>
              <div>
                <h3 className={styles.blockTitle}>Flip the day when you’re done</h3>
                <p className={styles.blockBody}>
                  Stay on today until you mean to leave it. Then look back, or
                  start the next page.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section className={styles.close} aria-labelledby="close-title">
          <h2 id="close-title" className={styles.headline}>
            Open the notebook.
          </h2>
          <p className={styles.lede}>
            Your log stays on your account. Sign in when you are ready to write.
          </p>
          <Link to="/login" className="btn-primary">
            Open your notebook
          </Link>
        </section>
      </main>

      <footer className={styles.foot}>
        <span>© {new Date().getFullYear()} Flops</span>
        <Link to="/login">Sign in</Link>
        <span>Your log stays on your account. We don’t sell it.</span>
      </footer>
    </div>
  );
}
