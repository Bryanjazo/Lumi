// Sign-up entry route. The actual UI lives in AuthDoor — one warm
// door, two modes (lumi-auth.jsx). Keeping a dedicated route here
// preserves any existing deep links / referrals to /auth/sign-up;
// the bottom toggle inside AuthDoor flips to sign-in in place
// without navigating.

import { AuthDoor } from '../../components/auth/AuthDoor';

export default function SignUpScreen() {
  return <AuthDoor initialMode="signup" />;
}
