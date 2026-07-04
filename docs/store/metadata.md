# Lumi · App Store metadata (v1.0)

Paste-ready. Swap lumitasks.app once the domain exists.

---

## Name (24/30)
```
Lumi: Brain Dump to Done
```

## Subtitle (29/30)
```
Quiet your mind. Finish more.
```

## Promotional text (168/170 — updatable anytime without review)
```
Your brain has 42 tabs open. Talk them all out — Lumi turns the chaos into a plan, learns when you work best, and never makes you feel bad for being human.
```

## Keywords (97/100 — no spaces after commas; "brain dump" already in the name, so not repeated here)
```
adhd,task manager,planner,to do list,focus,executive function,daily,routine,neurodivergent,habit
```

## Description (~2,300/4,000)
```
Your brain won't shut off. Thirty things to do, no idea where to start, and every task app you've tried just gave you another list to feel behind on.

Lumi works the way your brain actually does: you talk, it organizes.

BRAIN DUMP TO DONE
Open Lumi and say everything — "call the dentist, groceries this weekend, mom's birthday is coming, I keep putting off the report." Messy is fine. Lumi splits it into real tasks, gives each one a time that fits your day, and catches the feelings ("I'm so stressed") without turning them into to-dos.

IT LEARNS HOW YOU WORK
Lumi notices when you actually finish things — your sharp mornings, your 3pm dip — and starts placing hard tasks in your strong hours automatically. Correct it once ("gym goes in the evening") and it remembers. The longer you use it, the more it feels like it knows you. Because it does.

NEVER SHAMED FOR BEING HUMAN
No red overdue walls. No guilt notifications. Miss a few days and Lumi greets you like a friend — "Life happened. What feels possible today?" — then shrinks your backlog to something doable. Finish the thing you've been avoiding for a week and THAT's when Lumi celebrates.

MEET LUNA
A small pixel cat keeps you company — content when you're on a roll, asleep when you should be, sitting beside you when you say you're overwhelmed. Never disappointed in you. (Prefer a plain, calm tool? Companion mode turns the whole game layer off.)

ALSO IN LUMI
• Untangle — feeling buried? Talk it through and watch your day rearrange itself
• Focus sessions with Live Activities on your lock screen
• A Load Map calendar that shows how heavy each day really is
• Voice capture, transcribed privately on your device
• A weekly story about your week — worth sharing, not a stats dump
• Works fully offline: the understanding engine on your phone doesn't need the cloud

FREE & PRO
The core of Lumi is free, forever — capture, organize, focus, learn. Lumi Pro adds unlimited AI conversations and deeper insight, with a free trial to see if it earns its keep. Your free plan never expires.

Built for ADHD brains. Made for anyone whose mind is loud.

Privacy: your tasks sync securely, encrypted on device, never sold, never used for ads. Full policy: lumitasks.app/privacy
```

## What's New (v1.0)
```
Hello, world. Lumi 1.0 — brain dump to done.
```

---

## App Review notes (paste into App Review Information → Notes)
```
Lumi is a task manager for ADHD/busy minds: the user speaks or types a messy "brain dump" and the app deterministically (and optionally with AI) organizes it into scheduled tasks.

DEMO ACCOUNT: use the credentials provided below. The account is pre-seeded with tasks so all surfaces are populated.

KEY FLOWS (60 seconds):
1. Home → tap "Dump a thought…" → type: "call the dentist tomorrow, groceries this weekend, finish the report by friday" → three organized tasks appear for review → Accept.
2. Untangle tab → tap "I'm overwhelmed" → the app proposes a lighter plan.
3. Focus tab → pick a task → start a timed focus session (Live Activity appears on lock screen).

AI ARCHITECTURE: AI requests go exclusively through our own Supabase Edge Function proxy — no AI provider API key ships in the binary. The app is fully functional WITHOUT AI: if the network/AI is unavailable, an on-device engine handles all parsing (you can verify by using the app in airplane mode after sign-in).

SUBSCRIPTION: Lumi Pro (monthly with 7-day free trial / annual intro price) raises AI usage limits. All core functionality is available on the free tier — the app is never locked behind the paywall. Purchases via StoreKit/RevenueCat.

VOICE: speech is transcribed on-device by iOS speech recognition (see mic/speech permission strings). No audio is uploaded.

ACCOUNT DELETION: Profile → bottom → Delete account (server-side deletion via Edge Function).
```

---

## Screenshot shot-list (6.9" iPhone, 5–8 shots)

Order sells the transformation first, the soul second:

1. **The transformation (hero).** Split or before/after: capture bar with a messy run-on sentence → the sorted preview ("1 of 3") beneath. Caption: **"Say everything. It becomes a plan."**
2. **Home with a hero task.** The one-thing card + "8 more waiting — Lumi's holding them." Caption: **"One thing at a time. The rest is held."**
3. **Untangle mid-conversation.** The "I'm so overwhelmed" exchange with the warm reply + Arrange it button. Caption: **"Overwhelmed? Say so. Watch it lighten."**
4. **Load Map month view.** Heat dots + month pulse panel. Caption: **"See how heavy each day really is."**
5. **Focus session.** Timer + Live Activity. Caption: **"Focus that follows you to the lock screen."**
6. **Luna's room (Me tab).** Warm room, cat by the fire. Caption: **"A companion, not a taskmaster."**
7. *(Optional)* Weekly Lumi Story share card. Caption: **"Your week, told like a story."**

Style: real app frames on the dark palette, one short Fraunces-italic caption per shot, no feature-list walls. Shots must show realistic tasks (dentist, groceries, report — not lorem).

---

## ASC field checklist (version page)
- [ ] Screenshots 6.9" (iPhone-only now — supportsTablet is false)
- [ ] Promotional text · Description · Keywords · What's New (above)
- [ ] Support URL: https://lumitasks.app/support
- [ ] Marketing URL (optional): https://lumitasks.app
- [ ] Privacy Policy URL (App Privacy section): https://lumitasks.app/privacy
- [ ] App Review Information: demo account email/password + notes (above) + your contact phone/email
- [ ] Version release: "Manually release this version" (recommended for launch-day control)
- [ ] Attach build 52
```
