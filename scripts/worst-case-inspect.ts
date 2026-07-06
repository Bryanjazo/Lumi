import { parseSmartCapture, routeCapture, type CaptureContext } from '../lib/capture';

const NOW = new Date(2026, 6, 3, 10, 0, 0); // Friday 10:00
const ctx = {
  sharpWindow: null, foggyWindow: null,
  peakStart: null, peakEnd: null, slumpStart: null, slumpEnd: null,
  effectiveWindows: {
    morning: { key: 'morning', label: 'Morning', start: 7, end: 11 },
    midday: { key: 'midday', label: 'Midday', start: 11, end: 14 },
    afternoon: { key: 'afternoon', label: 'Afternoon', start: 14, end: 17 },
    evening: { key: 'evening', label: 'Evening', start: 17, end: 22 },
    someday: { key: 'someday', label: 'Someday', start: null, end: null },
  },
  now: NOW, nowMin: 600, wakeMin: 420, sleepMin: 1380,
  anchors: { wake: 420, breakfast: 480, lunch: 750, dinner: 1110, sleep: 1380 },
} as unknown as CaptureContext;

const WORST = [
  "cant sleep too much to do tmrw rent gym call mom ugh",
  "i have no idea where to start laundry dishes emails everywhere",
  "the report is due tmrw and i havent even started also dishes",
  "brain wont shut up dentist bills that email to karen the leak under the sink",
  "call insurance guy?? maybe idk also groceries",
  "need to do smth about the car",
  "everything is piling up rent due friday moms bday saturday gotta buy smth",
  "so tired. gym maybe. eat something real.",
  "email prof about the extension assignment due monday im screwed",
  "rent gym mom karen email",
  "ok ok ok dishes laundry call the bank before 5 dont forget meds",
  "why cant i just do things. anyway. dentist.",
  "supposed to call dad back like 3 days ago",
  "clean kitchen?? or at least the sink. and trash",
  "taxes. i know. i know. taxes.",
  "buy dog food were completely out also vet appt sometime",
  "have to email that guy about the thing tmrw morning",
  "grocery run milk eggs coffee the good bread",
  "pick up my meds pharmacy closes at 7",
  "im drowning in emails just need to answer sarah and the hoa one",
];

for (const raw of WORST) {
  const tasks = parseSmartCapture(raw, ctx);
  const gate = routeCapture(raw, tasks);
  console.log(`\nIN:  ${raw}`);
  console.log(`GATE: ${gate.route} (${gate.reason})`);
  for (const t of tasks) {
    const bits = [
      `"${t.title}"`,
      t.importance,
      t.window,
      t.at != null ? `@${Math.floor(t.at/60)}:${String(t.at%60).padStart(2,'0')}` : '',
      t.date ?? '',
      t.note ? `note:"${t.note}"` : '',
      t.durationMinutes ? `${t.durationMinutes}m` : '',
    ].filter(Boolean).join(' · ');
    console.log(`  → ${bits}`);
  }
  if (tasks.length === 0) console.log('  → (no tasks)');
}
