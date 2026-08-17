import React from 'react';

import { LegalPage } from '@/components/LegalPage';

export default function PrivacyScreen() {
  return (
    <LegalPage
      title="Privacy Policy"
      paragraphs={[
        'Your journal, meals and progress photos are private to your account. Squadmates see completion status only — never your journal, metrics or photos.',
        'Body metrics (if you choose to record them) are treated as health data: visible only to you, included in account deletion, never shared or sold.',
        'Deleting your account erases your challenge history, journal, meals, milestones and metrics.',
      ]}
    />
  );
}
