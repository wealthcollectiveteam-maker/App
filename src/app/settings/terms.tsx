import React from 'react';

import { LegalPage } from '@/components/LegalPage';

export default function TermsScreen() {
  return (
    <LegalPage
      title="Terms of Service"
      paragraphs={[
        'Ranked Fitness is a challenge tracker. You are responsible for training within your own limits; consult a professional before starting a demanding program.',
        'Content you post — pings, journal entries, squad activity — must not harass, threaten, or target other users. We remove content and accounts that do.',
        'Streaks, XP and badges have no monetary value and may be recalculated to correct errors.',
      ]}
    />
  );
}
