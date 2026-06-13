import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

const ANTHROPIC_API_KEY =
  process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? extra.ANTHROPIC_API_KEY ?? '';

export const isAnthropicConfigured = Boolean(ANTHROPIC_API_KEY);

const MODEL = 'claude-sonnet-4-6';
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

const CHECKIN_SYSTEM = `You are Lumi's emotional intelligence layer. The user has ADHD and has shared how they're feeling. Your response must:
1. Name the emotional state in 2-5 words (e.g. "Task paralysis + emotional overwhelm")
2. Explain what is neurologically happening in 2-3 sentences, plain language, no therapy jargon
3. Give exactly ONE concrete action — the smallest possible thing. Not a list.
Format as JSON: { "state": "...", "explanation": "...", "action": "..." }
Never use words: journey, mindful, validate, process, cope, strategies.`;

const BRAIN_DUMP_SYSTEM = `Parse this messy text into a list of discrete tasks. Each task should be actionable and specific. Return JSON: { "tasks": [{ "title": "...", "difficulty": "easy|medium|hard" }] }`;

const WEEKLY_REPORT_SYSTEM = `Generate a warm, personal weekly summary for an ADHD user. Reference their pet Luna by name. Tone: like a kind friend who understands ADHD, not a therapist. Include their wins first, then patterns, end with one encouraging sentence in italic that references Luna. Max 4 sentences total. Use their actual data provided.
Never use: journey, mindful, validate, process, cope, strategies, self-care.
Return JSON: { "summary": "..." }`;

export interface CheckinResponse {
  state: string;
  explanation: string;
  action: string;
}

export interface BrainDumpResponse {
  tasks: { title: string; difficulty: 'easy' | 'medium' | 'hard' }[];
}

export interface WeeklyReportResponse {
  summary: string;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  content: { type: string; text?: string }[];
  type?: string;
  error?: { type: string; message: string };
}

const callMessages = async (params: {
  system: string;
  messages: AnthropicMessage[];
  maxTokens: number;
}): Promise<string> => {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: params.messages,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text}`);
  }
  const body = (await res.json()) as AnthropicResponse;
  if (body.error) throw new Error(body.error.message);
  return body.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
};

const extractJson = <T,>(text: string): T => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in model response');
  return JSON.parse(match[0]) as T;
};

const FOLLOWUP_SYSTEM = `You are Lumi continuing a conversation about how the user is feeling. They've already received an initial diagnosis + action. Now they're sharing more context or asking for a different angle.

Respond in 2-3 short sentences. Plain language, no therapy jargon. One concrete, doable thing. Warm but direct.
Never use words: journey, mindful, validate, process, cope, strategies, self-care.
Return JSON: { "tip": "..." }`;

export interface FollowUpResponse {
  tip: string;
}

export const checkinFollowUp = async (params: {
  mood: string;
  initialState: string;
  initialAction: string;
  followUp: string;
}): Promise<FollowUpResponse> => {
  if (!isAnthropicConfigured) {
    return offlineFollowUp(params);
  }
  const text = await callMessages({
    system: FOLLOWUP_SYSTEM,
    maxTokens: 250,
    messages: [
      {
        role: 'user',
        content: `Mood: ${params.mood}
Initial diagnosis: ${params.initialState}
First action we gave them: ${params.initialAction}

What they said next: ${params.followUp}`,
      },
    ],
  });
  return extractJson<FollowUpResponse>(text);
};

const offlineFollowUp = (p: {
  mood: string;
  followUp: string;
}): FollowUpResponse => {
  const t = p.followUp.toLowerCase();
  if (/(work|deadline|boss)/.test(t))
    return {
      tip: "When the work pressure stacks, your brain reads it as physical danger. Step away from the screen for 90 seconds. Movement helps more than thinking through it does.",
    };
  if (/(sleep|tired|exhausted)/.test(t))
    return {
      tip: "Tired brains can't make tired decisions. Lower the bar to one small thing. The rest waits without you punishing yourself.",
    };
  if (/(food|eat|hungry)/.test(t))
    return {
      tip: "ADHD brains tend to skip hunger signals until they're already underwater. Eat something with protein in the next 20 minutes — even if you're not 'really hungry.'",
    };
  if (/(alone|lonely|isolated)/.test(t))
    return {
      tip: "Reach out to one person — even a single text. Not for them to fix it, just to register that you exist. That's enough.",
    };
  return {
    tip: "Whatever you're feeling right now is data, not a verdict. Pick the smallest possible next step. Don't aim higher than that — aim for now.",
  };
};

export const checkinResponse = async (params: {
  mood: string;
  text: string;
  petName: string;
}): Promise<CheckinResponse> => {
  if (!isAnthropicConfigured) {
    return offlineCheckin(params);
  }
  const text = await callMessages({
    system: CHECKIN_SYSTEM,
    maxTokens: 400,
    messages: [
      {
        role: 'user',
        content: `Mood selected: ${params.mood}\n\nWhat they wrote: ${params.text || '(no text)'}`,
      },
    ],
  });
  return extractJson<CheckinResponse>(text);
};

export const parseBrainDump = async (raw: string): Promise<BrainDumpResponse> => {
  if (!isAnthropicConfigured) {
    return offlineBrainDump(raw);
  }
  const text = await callMessages({
    system: BRAIN_DUMP_SYSTEM,
    maxTokens: 600,
    messages: [{ role: 'user', content: raw }],
  });
  return extractJson<BrainDumpResponse>(text);
};

export const weeklyReport = async (params: {
  petName: string;
  questsCompleted: number;
  streak: number;
  checkins: number;
  sosEvents: number;
  topMood: string;
}): Promise<WeeklyReportResponse> => {
  if (!isAnthropicConfigured) {
    return offlineReport(params);
  }
  const text = await callMessages({
    system: WEEKLY_REPORT_SYSTEM,
    maxTokens: 400,
    messages: [
      {
        role: 'user',
        content: `Pet name: ${params.petName}
Quests completed this week: ${params.questsCompleted}
Current streak: ${params.streak} days
Check-ins this week: ${params.checkins}
SOS moments: ${params.sosEvents}
Most common mood: ${params.topMood}`,
      },
    ],
  });
  return extractJson<WeeklyReportResponse>(text);
};

// ── Offline fallbacks (used when no API key is set) ───────────────────────
const offlineCheckin = (p: {
  mood: string;
  text: string;
}): CheckinResponse => {
  const map: Record<string, CheckinResponse> = {
    Foggy: {
      state: 'Cognitive haze',
      explanation:
        "Your prefrontal cortex is under-stimulated right now. It's not laziness — it's a chemistry dip. The brain needs a small, physical input to come back online.",
      action: 'Drink one full glass of water, slowly.',
    },
    Stuck: {
      state: 'Task paralysis',
      explanation:
        'When too many small decisions stack, the brain shuts the door. Activation energy gets too high. Picking anything restarts it.',
      action: 'Open the doc. Don’t write. Just open it.',
    },
    Anxious: {
      state: 'Threat scan active',
      explanation:
        "Your nervous system is reading the room for danger that isn't there. Slow breathing tells it the threat is gone.",
      action: 'Breathe out for 6 seconds. Once.',
    },
    Wired: {
      state: 'Dopamine spike',
      explanation:
        "Your system is over-firing — fast thoughts, hard to land. Movement burns the excess so focus returns.",
      action: 'Walk to the end of the hallway and back.',
    },
    Low: {
      state: 'Energy floor',
      explanation:
        "Glucose and motivation are both low. Big tasks feel impossible because the fuel isn't there.",
      action: 'Eat one small thing with protein.',
    },
    Drained: {
      state: 'Resource depletion',
      explanation:
        "You’ve been spending executive function all day. The reserve is empty. Tiny rest helps more than caffeine.",
      action: 'Lie flat for 4 minutes. No phone.',
    },
    Focused: {
      state: 'Hyperfocus window',
      explanation:
        "Dopamine and norepinephrine are aligned. Use it on the thing you care about most. Don't waste it on email.",
      action: 'Open the one project that matters.',
    },
    Good: {
      state: 'Regulated baseline',
      explanation:
        "Sleep, food, and movement are aligned. This is the state where habits stick — make a small one now.",
      action: 'Write tomorrow’s first quest.',
    },
  };
  return (
    map[p.mood] ?? {
      state: 'Mixed signal',
      explanation:
        "Something’s up but it doesn’t fit one box. That’s normal. Pick the smallest moveable thing.",
      action: 'Stand up for 30 seconds.',
    }
  );
};

const offlineBrainDump = (raw: string): BrainDumpResponse => {
  const lines = raw
    .split(/[\n.,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
    .slice(0, 6);
  return {
    tasks: lines.map((title) => ({
      title: title.charAt(0).toUpperCase() + title.slice(1),
      difficulty: title.length > 50 ? 'hard' : title.length > 20 ? 'medium' : 'easy',
    })),
  };
};

const offlineReport = (p: {
  petName: string;
  questsCompleted: number;
  streak: number;
}): WeeklyReportResponse => ({
  summary: `You completed ${p.questsCompleted} quests this week — that's real movement. Your ${p.streak}-day streak says your brain is finding rhythm, even on the hard days. The pattern is mid-week is when you land best. *${p.petName} curled up by the window today — proud of you.*`,
});
