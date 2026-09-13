import type * as React from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/app/routes';
import styles from './HomeHowItWorks.module.css';

export interface HomeHowItWorksProps {
  /** Reserved for future variants; the section is always expanded. */
  readonly collapsible?: boolean;
}

interface Step {
  readonly title: string;
  readonly text: string;
}

const STEPS: readonly Step[] = [
  {
    title: 'Connect & import',
    text: 'Fetch your recent Chess.com or Lichess games.',
  },
  {
    title: 'Extract tactics',
    text: 'Stockfish analyses them locally to find mistakes and the tactics you missed.',
  },
  {
    title: 'Train in cycles',
    text: 'Solve the puzzles in fixed blocks across cycles until your solving time halves.',
  },
];

function Header(): React.JSX.Element {
  return (
    <div className={styles.header}>
      <h2 className={styles.heading}>How ChessRemedy turns your games into practice</h2>
      <span className={styles.pill}>The Woodpecker method</span>
    </div>
  );
}

function Content(): React.JSX.Element {
  return (
    <>
      <ol className={styles.steps}>
        {STEPS.map((step, index) => (
          <li key={step.title} className={styles.step}>
            <span className={styles.stepNumber} aria-hidden="true">
              {index + 1}
            </span>
            <div className={styles.stepBody}>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepText}>{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className={styles.note}>Everything stays on this device; synchronization is optional.</p>
      <p className={styles.links}>
        <Link to={ROUTES.games}>Open the Game Library</Link>
        {' · '}
        <Link to={ROUTES.training}>Start Training</Link>
      </p>
    </>
  );
}

/**
 * Static "how it works / where to start" copy, always expanded (the page has a
 * single heading so the section carries no duplicate title).
 */
export function HomeHowItWorks(_props: HomeHowItWorksProps = {}): React.JSX.Element {
  return (
    <section
      className={styles.section}
      aria-label="How ChessRemedy turns your games into practice"
      data-testid="home-how-it-works"
    >
      <Header />
      <Content />
    </section>
  );
}
