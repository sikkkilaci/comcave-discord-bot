import type { OnboardingAnswer } from '@prisma/client';
import { prisma } from '../db/client.js';
import type { OnboardingAnswers, OnboardingQuestionKey } from '../services/onboardingFlow.js';

/**
 * Speichert eine Antwort auf eine Onboarding-Frage. Frueher gegebene Antworten
 * auf dieselbe Frage werden NICHT geloescht oder ueberschrieben, sondern es
 * wird ein neuer Eintrag angehaengt (Audit-Trail); beim Lesen zaehlt ueber
 * getLatestAnswers() immer der zuletzt gegebene Wert. Das macht ein erneutes
 * Ausfuellen des Onboardings verlustfrei moeglich.
 */
export async function recordAnswer(
  memberId: string,
  question: OnboardingQuestionKey,
  values: string[],
): Promise<OnboardingAnswer> {
  return prisma.onboardingAnswer.create({
    data: {
      memberId,
      question,
      answer: JSON.stringify(values),
    },
  });
}

/**
 * Liefert je Frage die zuletzt gegebene Antwort (aeltere Antworten auf
 * dieselbe Frage werden ignoriert). Reihenfolge nach createdAt aufsteigend,
 * damit ein einfaches "letzter Eintrag gewinnt" beim Zusammenfalten reicht.
 */
export async function getLatestAnswers(memberId: string): Promise<OnboardingAnswers> {
  const rows = await prisma.onboardingAnswer.findMany({
    where: { memberId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const answers: OnboardingAnswers = {};
  for (const row of rows) {
    answers[row.question as OnboardingQuestionKey] = JSON.parse(row.answer) as string[];
  }

  return answers;
}
