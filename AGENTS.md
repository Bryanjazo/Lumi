# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Branching

Every feature gets its own branch in the form **`feature/Lumi-NNNN`**, where
`NNNN` starts at `1000` and increments by 1 per feature. The number is the
feature ID — no other meaning. PRs are merged into `main`.

- `feature/Lumi-1000` — initial Expo scaffold (this app, baseline)
- `feature/Lumi-1001` — Supabase auth wiring
- `feature/Lumi-1002` — next feature, and so on

When asked to "start a new feature": branch off the latest merged base
(usually `main`), use the next free number, and commit the work there.
Don't push or open PRs without explicit user approval.
